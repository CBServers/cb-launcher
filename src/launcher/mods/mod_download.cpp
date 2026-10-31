#include "std_include.hpp"
#include "mod_download.hpp"

#include <utils/cdn.hpp>
#include <utils/hash.hpp>
#include <utils/http.hpp>
#include <utils/io.hpp>
#include <utils/string.hpp>

#include <numeric>

namespace mod_download
{
    namespace
    {
        constexpr std::string_view CDN_PREFIX = "cdn:";

        struct hash_cancelled
        {
        };

        std::filesystem::path partial_path(const std::filesystem::path& target, const std::string& hash)
        {
            auto part = target;
            part += "." + hash + ".part";
            return part;
        }

        // Split files log the length of every part already joined, so a resume knows which part it is in.
        std::filesystem::path parts_log_path(const std::filesystem::path& part)
        {
            auto log = part;
            log += ".json";
            return log;
        }

        std::vector<uint64_t> read_parts_log(const std::filesystem::path& log)
        {
            std::string data{};
            if (!utils::io::read_file(log, &data) || data.empty())
            {
                return {};
            }

            rapidjson::Document doc{};
            doc.Parse(data.data(), data.size());
            if (doc.HasParseError() || !doc.IsArray())
            {
                return {};
            }

            std::vector<uint64_t> lengths{};
            for (const auto& value : doc.GetArray())
            {
                if (!value.IsUint64())
                {
                    return {};
                }

                lengths.push_back(value.GetUint64());
            }

            return lengths;
        }

        bool write_parts_log(const std::filesystem::path& log, const std::vector<uint64_t>& lengths)
        {
            std::string data = "[";
            for (size_t i = 0; i < lengths.size(); ++i)
            {
                data += (i ? "," : "") + std::to_string(lengths[i]);
            }

            return utils::io::write_file(log, data + "]");
        }

        std::optional<std::string> resolve_link(const std::string& link, std::string& cdn_base)
        {
            if (utils::string::starts_with(link, "https://"))
            {
                return link;
            }

            if (!utils::string::starts_with(link, std::string{CDN_PREFIX}))
            {
                return std::nullopt;
            }

            if (cdn_base.empty())
            {
                cdn_base = utils::cdn::cdn_manager::instance().get_active_cdn_url();
            }

            return cdn_base + utils::string::url_encode_path(link.substr(CDN_PREFIX.size()));
        }
    }

    bool has_partial(const std::filesystem::path& target, const std::string& hash)
    {
        return utils::io::file_exists(partial_path(target, hash));
    }

    uint64_t partial_size(const std::filesystem::path& target, const std::string& hash)
    {
        return utils::io::file_size(partial_path(target, hash));
    }

    void remove_partial(const std::filesystem::path& target, const std::string& hash)
    {
        const auto part = partial_path(target, hash);
        utils::io::remove_file(part);
        utils::io::remove_file(parts_log_path(part));
    }

    std::string download(const request& file, const std::filesystem::path& target, const std::function<bool(uint64_t)>& on_progress)
    {
        if (file.links.empty())
        {
            return "No download link for " + file.name;
        }

        if (target.has_parent_path())
        {
            utils::io::create_directory(target.parent_path());
        }

        if (file.size == 0)
        {
            return utils::io::write_file(target, std::string{}) ? std::string{} : "Failed to write " + file.name;
        }

        const auto part = partial_path(target, file.hash);
        const auto log = parts_log_path(part);
        const auto split = file.links.size() > 1;
        const auto report = [&on_progress](const uint64_t received) { return !on_progress || on_progress(received); };

        // The .part's size on disk is the resume offset, mirroring the game updater.
        uint64_t received = utils::io::file_size(part);
        auto joined = split ? read_parts_log(log) : std::vector<uint64_t>{};
        auto joined_bytes = std::accumulate(joined.begin(), joined.end(), uint64_t{0});
        if (received > file.size || joined_bytes > received || joined.size() > file.links.size())
        {
            remove_partial(target, file.hash);
            received = 0;
            joined.clear();
            joined_bytes = 0;
        }

        std::ofstream ofs(part, std::ios::binary | (received > 0 ? std::ios::app : std::ios::trunc));
        if (!ofs)
        {
            return "Failed to open " + utils::string::path_to_utf8(part);
        }

        // Only a download starting at byte 0 can be hashed as it streams.
        std::optional<utils::hash::stream_hasher> hasher{};
        if (received == 0)
        {
            hasher.emplace();
        }

        // Cuts the .part back to `size`, dropping whatever a failed request appended.
        const auto rewind = [&](const uint64_t size) -> bool
        {
            ofs.close();
            hasher.reset();
            if (size == 0)
            {
                remove_partial(target, file.hash);
                received = 0;
                return true;
            }

            std::error_code code{};
            std::filesystem::resize_file(part, size, code);
            received = size;
            ofs.open(part, std::ios::binary | std::ios::app);
            return !code && ofs;
        };

        std::string cdn_base{};
        for (auto index = joined.size(); index < file.links.size() && received < file.size; ++index)
        {
            const auto& link = file.links[index];
            auto cancelled = false;
            auto write_failed = false;
            uint64_t attempt_offset = 0;
            std::optional<utils::http::result> data{};

            // A dead CDN mirror swaps to the next one and resumes there instead of failing the file.
            for (;;)
            {
                const auto url = resolve_link(link, cdn_base);
                if (!url)
                {
                    ofs.close();
                    remove_partial(target, file.hash);
                    return "Unsupported download link for " + file.name;
                }

                attempt_offset = received - joined_bytes;
                data = utils::http::get_data_stream(*url, {}, {}, {},
                    [&](const char* chunk, const size_t size) -> bool
                    {
                        if (chunk && size > 0)
                        {
                            ofs.write(chunk, static_cast<std::streamsize>(size));
                            if (!ofs)
                            {
                                write_failed = true;
                                return false;
                            }

                            if (hasher)
                            {
                                hasher->update(chunk, size);
                            }

                            received += size;
                        }

                        if (!report(received))
                        {
                            cancelled = true;
                            return false;
                        }

                        return true;
                    },
                    [&]() -> bool { return !write_failed && !cancelled; },
                    0, 5, attempt_offset);

                const auto unreachable = data && data->code != CURLE_OK && data->response_code == 0;
                if (unreachable && !cancelled && !write_failed && utils::string::starts_with(link, std::string{CDN_PREFIX}))
                {
                    if (const auto next = utils::cdn::cdn_manager::instance().failover(cdn_base))
                    {
                        cdn_base = *next;
                        continue;
                    }
                }

                break;
            }

            ofs.flush();
            if (cancelled)
            {
                return "cancelled"; // the part stays behind as the resume point
            }

            if (write_failed || !ofs)
            {
                ofs.close();
                remove_partial(target, file.hash);
                return "Failed to write " + utils::string::path_to_utf8(part) + ", the disk may be full or write-protected";
            }

            if (!data)
            {
                return "Failed to download " + file.name;
            }

            // A part that already arrived whole (the log write was interrupted) answers its resume with 416.
            if (split && attempt_offset > 0 && data->response_code == 416)
            {
                if (!rewind(joined_bytes + attempt_offset))
                {
                    remove_partial(target, file.hash);
                    return "Failed to write " + utils::string::path_to_utf8(part);
                }
            }
            else if (data->range_ignored || data->response_code == 416)
            {
                // What we hold of this part can't be extended; keep the joined parts so the retry refetches only it.
                rewind(joined_bytes);
                return "Resume rejected for " + file.name;
            }
            else if (data->code != CURLE_OK)
            {
                return utils::string::va("Failed to download %s, CURL error %d", file.name.data(), data->code);
            }
            else if (data->response_code >= 400)
            {
                rewind(joined_bytes);
                return utils::string::va("Failed to download %s, HTTP %u", file.name.data(), data->response_code);
            }

            joined.push_back(received - joined_bytes);
            joined_bytes = received;
            if (split && index + 1 < file.links.size() && !write_parts_log(log, joined))
            {
                ofs.close();
                remove_partial(target, file.hash);
                return "Failed to write " + utils::string::path_to_utf8(log);
            }
        }

        ofs.close();

        if (utils::io::file_size(part) != file.size)
        {
            remove_partial(target, file.hash);
            return "Size mismatch for " + file.name;
        }

        std::string hash{};
        try
        {
            hash = hasher ? hasher->digest() : utils::hash::get_file_hash(part, [&report, &received]
            {
                if (!report(received))
                {
                    throw hash_cancelled{};
                }
            });
        }
        catch (const hash_cancelled&)
        {
            return "cancelled";
        }

        if (hash != file.hash)
        {
            remove_partial(target, file.hash);
            return "Hash mismatch for " + file.name;
        }

        if (!utils::io::move_file_replace(part, target))
        {
            return "Failed to move " + file.name + " into place";
        }

        utils::io::remove_file(log);
        return {};
    }
}
