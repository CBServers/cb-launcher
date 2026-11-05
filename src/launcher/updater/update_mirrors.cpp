#include <std_include.hpp>

#include "update_mirrors.hpp"

#include <utils/cdn.hpp>
#include <utils/cryptography.hpp>
#include <utils/http.hpp>
#include <utils/logger.hpp>
#include <utils/string.hpp>

namespace update_mirrors
{
    namespace
    {
        constexpr auto CDN_TREE = "updater/";
        constexpr int MANIFEST_TIMEOUT_SECONDS = 15;
        constexpr uint32_t MANIFEST_RETRIES = 1;
        constexpr uint32_t FILE_RETRIES = 2;

        std::string get_cache_buster()
        {
            return "?" + std::to_string(
                std::chrono::duration_cast<std::chrono::nanoseconds>(
                    std::chrono::system_clock::now().time_since_epoch()).count());
        }

        std::string describe_failure(const std::optional<utils::http::result>& result)
        {
            if (!result)
            {
                return "no response";
            }

            if (result->code != CURLE_OK)
            {
                return curl_easy_strerror(result->code);
            }

            return utils::string::va("HTTP %u", result->response_code);
        }

        bool is_success(const std::optional<utils::http::result>& result)
        {
            return result && result->code == CURLE_OK && result->response_code >= 200 && result->response_code < 300;
        }

        std::string join_errors(const std::vector<std::string>& errors)
        {
            std::string joined{};
            for (const auto& error : errors)
            {
                joined += "\n" + error;
            }
            return joined;
        }
    }

    std::vector<route> routes()
    {
        std::vector<route> result{};

        for (const auto& group : utils::cdn::cdn_manager::instance().mirror_groups())
        {
            for (const auto& host : group)
            {
                route r{};
                r.bases.emplace_back(host + CDN_TREE);
                for (const auto& sibling : group)
                {
                    if (sibling != host)
                    {
                        r.bases.emplace_back(sibling + CDN_TREE);
                    }
                }
                r.bases.emplace_back(GITHUB_BASE);
                result.emplace_back(std::move(r));
            }
        }

        result.emplace_back(route{{GITHUB_BASE}});
        return result;
    }

    std::optional<std::string> tree_path(const std::string& url)
    {
        const std::string_view base{GITHUB_BASE};
        if (!url.starts_with(base))
        {
            return std::nullopt;
        }

        return url.substr(base.size());
    }

    manifest_result fetch_manifest(const std::vector<route>& routes, const std::string& path,
        const std::function<bool(const std::string&)>& valid)
    {
        std::vector<std::string> errors{};

        for (const auto& r : routes)
        {
            const auto url = r.bases.front() + path;
            const auto result = utils::http::get_data(url + get_cache_buster(), {}, {}, {},
                MANIFEST_TIMEOUT_SECONDS, MANIFEST_RETRIES);

            std::string error{};
            if (!is_success(result))
            {
                error = describe_failure(result);
            }
            else if (!valid(result->buffer))
            {
                error = "empty or invalid manifest";
            }
            else
            {
                return {result->buffer, r};
            }

            utils::logger::write("Manifest {} failed: {}", url, error);
            errors.emplace_back(url + ": " + error);
        }

        throw std::runtime_error("Failed to fetch update manifest" + join_errors(errors));
    }

    fetch_status fetch_file(const route& source, const std::string& folder, const updater::file_info& file,
        const std::function<bool(size_t)>& progress, std::string& data)
    {
        std::vector<std::string> errors{};

        for (const auto& base : source.bases)
        {
            const auto url = base + folder + utils::string::url_encode_path(file.name) + "?" + file.hash;
            utils::logger::write("Updating file {}", url);

            auto result = utils::http::get_data(url, {}, {},
                [&](const size_t downloaded, size_t, size_t) { return progress(downloaded); }, 0, FILE_RETRIES);

            if (result && result->code == CURLE_ABORTED_BY_CALLBACK)
            {
                return fetch_status::cancelled;
            }

            std::string error{};
            if (!is_success(result))
            {
                error = describe_failure(result);
            }
            else if (result->buffer.size() != file.size)
            {
                error = utils::string::va("size %zu, expected %zu", result->buffer.size(), file.size);
            }
            else if (utils::cryptography::sha1::compute(result->buffer, true) != file.hash)
            {
                error = "hash mismatch";
            }
            else
            {
                data = std::move(result->buffer);
                return fetch_status::ok;
            }

            utils::logger::write("Download {} failed: {}", url, error);
            errors.emplace_back(url + ": " + error);
        }

        throw std::runtime_error("Failed to download " + file.name + join_errors(errors));
    }
}
