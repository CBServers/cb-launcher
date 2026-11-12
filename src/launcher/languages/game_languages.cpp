#include "std_include.hpp"
#include "game_languages.hpp"

#include <plutonium/plutonium.hpp>
#include <utils/cryptography.hpp>
#include <utils/string.hpp>
#include <utils/nt.hpp>
#include <curl/curl.h>
#include <array>
#include <chrono>
#include <limits>
#include <map>
#include <climits>
#include <memory>

namespace game_languages
{
    namespace
    {
        namespace fs = std::filesystem;
        constexpr size_t metadata_limit = 2 * 1024 * 1024;
        constexpr uint64_t pack_limit = 16ULL * 1024 * 1024 * 1024;
        constexpr auto host = "https://fastdl.erodednetworks.com/Game%20Language%20installs/";
        struct pack
        {
            const char* game;
            const char* value;
            const char* locale;
            const char* language;
            const char* hash;
        };
        // Raw public inventories reviewed on 2026-11-12. A changed inventory needs a code review.
        constexpr pack packs[] = {
            {"t5", "fr", "fr-FR", "french", "4f39b90d47d361c33c357f963dcfbd0f44f986b215e9708170d8fde74ef5f172"},
            {"t5", "de", "de-AT", "german", "267316362eb71f1c98fc48bc35c02b834d82dfc44fb43ac787b9adb9ee41fe9f"},
            {"t5", "it", "it-IT", "italian", "36fc064b8311cf98261d572da494c1be18134a1eed7df3371213abfc152ed66c"},
            {"t5", "es", "es-ES", "spanish", "0f5c253aa9d6d3c67f28f7688e21a8d005fcc10b6f02f4919595f8e360bb025f"},
            {"t5", "ja", "ja-JP", "japanese", "975d0fd2fce5cff3f4888fff36753b93e76c639c42cb5dc9b4db36e36c7868f9"},
            {"t6", "fr", "fr-FR", "french", "1c4614996e4fa51fdccc68a8e02468f9020f7b11a62c0dd0dc52e5237a54fa83"},
            {"t6", "de", "de-DE", "german", "59966bf47dc4d40556b4a8e882b354ca3986e1816a27de66c4287afa05201c8a"},
            {"t6", "it", "it-IT", "italian", "cc936d8184eb13dcf06acf9e30fc2e9ba37d345fef591e3581bbe7210143aa4a"},
            {"t6", "es", "es-ES", "spanish", "2a4872f5231c79f7ee556bfe70424c879beb9e4a5de69e7e76b08d1a096d4be8"},
            {"t6", "ja", "ja-JP", "japanese", "1d115ba0ed27f7ce827b6468a0cdd188cf597e84cd1e49c4dc180852e10bbf2a"},
            {"t4", "fr", "fr-FR", "french", "994b6201c713becb7d2d1a2193be8ac4514530287ff31995d32e555a62bed6ef"},
            {"t4", "it", "it-IT", "italian", "5d3d27ff0111cdf552051c3b0e5d55ad8801071347b8ad6e07b3aba87cfeae1a"},
            {"t4", "es", "es-ES", "spanish", "ccdbbd1d1719874ed61719f7cf5797f18bfa1e06293f417e00c2e94b763c69db"},
            {"t4", "ko", "ko-KR", "korean", "3c4a6df5dd4f1b4cb5dee2f05970f8444e985e5219c637b5425becfc8375bfb6"},
        };

        [[noreturn]] void fail(const std::string& message)
        {
            throw std::runtime_error("Game language: " + message);
        }
        std::string lower(std::string value)
        {
            for (auto& c : value)
                if (c >= 'A' && c <= 'Z')
                    c += 'a' - 'A';
            return value;
        }
        const pack* find_pack(std::string_view game, std::string_view value)
        {
            for (const auto& p : packs)
                if (game == p.game && value == p.value)
                    return &p;
            return nullptr;
        }
        std::string en_game(std::string_view game)
        {
            return game == "t4" ? "waw" : game == "t5" ? "bo1" : "bo2";
        }
        bool hash_valid(const std::string& value)
        {
            return value.size() == 64 && std::all_of(value.begin(), value.end(), [](char c)
                                                     { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'); });
        }
        void check_cancel(updater::ui_progress_listener& listener)
        {
            listener.wait_if_paused();
            if (listener.is_update_cancelled())
                fail("installation cancelled");
        }
        bool any_game_running(const game_config::game_config_t& config)
        {
            std::vector<std::string> retail;
            for (const auto& file : config.valid_game_files)
                if (lower(fs::path(file).extension().string()) == ".exe")
                    retail.push_back(file);
            return game_config::is_game_process_running(config.id) || plutonium::is_game_running() ||
                   utils::nt::is_any_process_running(retail, 0);
        }
        struct digest
        {
            hash_state state{};
            digest()
            {
                if (sha256_init(&state) != CRYPT_OK)
                    fail("cannot initialize SHA-256");
            }
            void update(const char* data, size_t size)
            {
                if (size > ULONG_MAX || sha256_process(&state, reinterpret_cast<const unsigned char*>(data),
                                                       static_cast<unsigned long>(size)) != CRYPT_OK)
                    fail("cannot hash file");
            }
            std::string finish()
            {
                unsigned char bytes[32];
                if (sha256_done(&state, bytes) != CRYPT_OK)
                    fail("cannot finish SHA-256");
                constexpr char hex[] = "0123456789abcdef";
                std::string out;
                out.reserve(64);
                for (auto b : bytes)
                {
                    out += hex[b >> 4];
                    out += hex[b & 15];
                }
                return out;
            }
        };

        // Check every ancestor, including the volume/root. Windows junctions are reparse points,
        // so symlink_status alone is insufficient. Never traverse a reparse point for writes or reads.
        void safe_path(const fs::path& input)
        {
            if (!input.is_absolute())
                fail("expected an absolute path");
            const auto normalized = input.lexically_normal();
            fs::path current = normalized.root_path();
            const auto check = [&]()
            {
                const auto attributes = GetFileAttributesW(current.c_str());
                if (attributes == INVALID_FILE_ATTRIBUTES)
                {
                    const auto error = GetLastError();
                    if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND)
                        return;
                    fail("cannot inspect " + utils::string::path_to_utf8(current));
                }
                if (attributes & FILE_ATTRIBUTE_REPARSE_POINT)
                    fail("junctions and symbolic links are not supported: " + utils::string::path_to_utf8(current));
            };
            check();
            for (const auto& part : normalized.relative_path())
            {
                current /= part;
                check();
            }
        }
        bool exists_file(const fs::path& p)
        {
            safe_path(p);
            if (!fs::exists(p))
                return false;
            if (!fs::is_regular_file(p))
                fail("expected a regular file: " + utils::string::path_to_utf8(p));
            return true;
        }
        void directories(const fs::path& p)
        {
            safe_path(p);
            fs::create_directories(p);
            safe_path(p);
        }
        void remove_file(const fs::path& p)
        {
            if (exists_file(p))
            {
                if (!fs::remove(p))
                    fail("cannot remove file");
            }
        }
        void remove_tree(const fs::path& p)
        {
            safe_path(p);
            if (!fs::exists(p))
                return;
            for (const auto& e : fs::recursive_directory_iterator(p))
                safe_path(e.path());
            fs::remove_all(p);
        }
        void durable(const fs::path& p)
        {
            safe_path(p);
            const auto handle = CreateFileW(p.c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                                            FILE_ATTRIBUTE_NORMAL, nullptr);
            if (handle == INVALID_HANDLE_VALUE)
                fail("cannot flush file");
            const bool ok = FlushFileBuffers(handle) != FALSE;
            CloseHandle(handle);
            if (!ok)
                fail("cannot flush file");
        }
        void copy_checked(const fs::path& source, const fs::path& target)
        {
            if (!exists_file(source))
                fail("a recovery backup is missing");
            directories(target.parent_path());
            safe_path(target);
            if (!CopyFileW(source.c_str(), target.c_str(), FALSE))
                fail("cannot copy " + utils::string::path_to_utf8(target));
            durable(target);
        }
        std::string read(const fs::path& p)
        {
            if (!exists_file(p))
                return {};
            if (fs::file_size(p) > metadata_limit)
                fail("metadata is too large");
            std::ifstream in(p, std::ios::binary);
            if (!in)
                fail("cannot read metadata");
            std::string out(static_cast<size_t>(fs::file_size(p)), '\0');
            in.read(out.data(), static_cast<std::streamsize>(out.size()));
            if (!in || static_cast<size_t>(in.gcount()) != out.size())
                fail("cannot read metadata");
            return out;
        }
        void write_atomic(const fs::path& p, const std::string& text)
        {
            directories(p.parent_path());
            auto temporary = p;
            temporary += L".tmp";
            safe_path(temporary);
            safe_path(p);
            std::ofstream out(temporary, std::ios::binary | std::ios::trunc);
            out.write(text.data(), static_cast<std::streamsize>(text.size()));
            out.flush();
            if (!out)
                fail("cannot save recovery metadata");
            out.close();
            durable(temporary);
            if (!MoveFileExW(temporary.c_str(), p.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH))
                fail("cannot commit recovery metadata");
        }
        std::pair<std::string, uint64_t> hash_file(const fs::path& p, updater::ui_progress_listener* listener = nullptr)
        {
            if (!exists_file(p))
                fail("file is missing: " + utils::string::path_to_utf8(p));
            std::ifstream in(p, std::ios::binary);
            if (!in)
                fail("cannot read file");
            digest h;
            uint64_t bytes = 0;
            std::array<char, 65536> block;
            while (in)
            {
                if (listener)
                    check_cancel(*listener);
                in.read(block.data(), block.size());
                const auto size = in.gcount();
                if (size > 0)
                {
                    h.update(block.data(), static_cast<size_t>(size));
                    bytes += size;
                }
            }
            if (!in.eof())
                fail("cannot read file");
            return {h.finish(), bytes};
        }
        void require_hash(const fs::path& p, const std::string& hash, uint64_t size)
        {
            const auto actual = hash_file(p);
            if (actual.first != hash || actual.second != size)
                fail("a recovery backup changed; original files were preserved");
        }
        rapidjson::Document parse(const std::string& text)
        {
            rapidjson::Document doc;
            doc.Parse(text.data(), text.size());
            if (doc.HasParseError() || !doc.IsObject())
                fail("invalid recovery/inventory metadata");
            return doc;
        }
        std::string str(const rapidjson::Value& obj, const char* name)
        {
            if (!obj.IsObject() || !obj.HasMember(name) || !obj[name].IsString())
                fail(std::string("invalid metadata field: ") + name);
            const auto& v = obj[name];
            std::string out(v.GetString(), v.GetStringLength());
            if (out.find('\0') != std::string::npos)
                fail("embedded null in metadata");
            return out;
        }
        bool boolean(const rapidjson::Value& obj, const char* name)
        {
            if (!obj.HasMember(name) || !obj[name].IsBool())
                fail("invalid recovery flag");
            return obj[name].GetBool();
        }
        uint64_t number(const rapidjson::Value& obj, const char* name)
        {
            if (!obj.HasMember(name) || !obj[name].IsUint64())
                fail("invalid metadata size");
            return obj[name].GetUint64();
        }
        void add(rapidjson::Value& obj, const char* key, const std::string& value,
                 rapidjson::Document::AllocatorType& a)
        {
            obj.AddMember(rapidjson::Value(key, a),
                          rapidjson::Value(value.data(), static_cast<rapidjson::SizeType>(value.size()), a), a);
        }
        std::string serialize(const rapidjson::Value& v)
        {
            rapidjson::StringBuffer out;
            rapidjson::Writer<rapidjson::StringBuffer> w(out);
            v.Accept(w);
            return {out.GetString(), out.GetSize()};
        }

        struct roots
        {
            fs::path game, storage, state;
            explicit roots(const game_config::game_config_t& config)
            {
                const auto root = config.get_install_path();
                if (!root || root->empty())
                    fail("choose the game installation first");
                game = fs::absolute(*root).lexically_normal();
                safe_path(game);
                if (!fs::is_directory(game))
                    fail("game installation is missing");
                state = game / L".cb-language";
                safe_path(state);
                const auto pluto = plutonium::get_root();
                if (!pluto.empty())
                    storage = fs::absolute(pluto / L"storage" / L"t5").lexically_normal();
            }
            fs::path live(const std::string& relative, bool use_storage) const
            {
                if (!detail::safe_relative(relative))
                    fail("unsafe language path");
                if (use_storage && storage.empty())
                    fail("Plutonium storage is unavailable");
                const auto target = (use_storage ? storage : game) / utils::string::utf8_to_path(relative);
                safe_path(target);
                return target;
            }
        };
        struct entry
        {
            std::string path, hash, original_hash;
            uint64_t size = 0, original_size = 0;
            bool storage = false, original = false;
            size_t backup = 0;
        };
        struct receipt
        {
            std::string language = "source", generation, text;
            std::vector<entry> entries;
        };
        std::string key(const entry& e)
        {
            return (e.storage ? "s:" : "g:") + lower(e.path);
        }
        bool generation_valid(const std::string& value)
        {
            return std::regex_match(value, std::regex("generation-[0-9]+-[0-9]+"));
        }
        bool allowed_any(const std::string& game, const std::string& relative, bool storage)
        {
            if (storage)
                return game == "t5" && detail::allowed_path(game, "ja", relative);
            if (game == "t5" || game == "t4")
            {
                const auto p = lower(relative);
                if (std::regex_match(p, std::regex("main/localized_english_iw[0-9]+\\.iwd")) ||
                    std::regex_match(p, std::regex("zone/english/[a-z0-9_-]+\\.ff")))
                    return true;
            }
            for (const auto& p : packs)
                if (game == p.game && !(game == "t5" && std::string_view(p.value) == "ja") &&
                    detail::allowed_path(game, p.value, relative))
                    return true;
            return false;
        }
        receipt decode_receipt(const std::string& text, const roots& root, const std::string& game)
        {
            receipt result;
            result.text = text;
            if (text.empty())
                return result;
            auto doc = parse(text);
            if (str(doc, "game") != game || lower(str(doc, "root")) != lower(utils::string::path_to_utf8(root.game)))
                fail("receipt belongs to another installation");
            result.language = str(doc, "language");
            result.generation = str(doc, "generation");
            if (!find_pack(game, result.language) || !generation_valid(result.generation) ||
                !doc.HasMember("entries") || !doc["entries"].IsArray() || doc["entries"].Size() > 4096)
                fail("invalid language receipt");
            std::set<std::string> seen;
            for (const auto& v : doc["entries"].GetArray())
            {
                entry e;
                e.path = str(v, "path");
                e.storage = boolean(v, "storage");
                e.hash = str(v, "hash");
                e.size = number(v, "size");
                e.original = boolean(v, "original");
                e.original_hash = str(v, "originalHash");
                e.original_size = number(v, "originalSize");
                e.backup = static_cast<size_t>(number(v, "backup"));
                if (!detail::safe_relative(e.path) || !allowed_any(game, e.path, e.storage) ||
                    (!e.hash.empty() && !hash_valid(e.hash)) || (e.original && !hash_valid(e.original_hash)) ||
                    e.backup >= 4096 || !seen.insert(key(e)).second)
                    fail("invalid receipt path/hash");
                if (e.storage && str(doc, "storageRoot") != utils::string::path_to_utf8(root.storage))
                    fail("Plutonium storage moved; restore with its original location first");
                result.entries.push_back(e);
            }
            return result;
        }
        receipt load_receipt(const roots& root, const std::string& game)
        {
            const auto file = root.state / L"installed.json";
            const auto text = read(file);
            if (text.empty() && exists_file(file))
                fail("empty language receipt; preserve the recovery directory");
            return decode_receipt(text, root, game);
        }
        std::string receipt_text(const roots& root, const std::string& game, const receipt& value)
        {
            rapidjson::Document d;
            d.SetObject();
            auto& a = d.GetAllocator();
            add(d, "game", game, a);
            add(d, "root", utils::string::path_to_utf8(root.game), a);
            add(d, "storageRoot", utils::string::path_to_utf8(root.storage), a);
            add(d, "language", value.language, a);
            add(d, "generation", value.generation, a);
            rapidjson::Value list(rapidjson::kArrayType);
            for (const auto& e : value.entries)
            {
                rapidjson::Value v(rapidjson::kObjectType);
                add(v, "path", e.path, a);
                add(v, "hash", e.hash, a);
                add(v, "originalHash", e.original_hash, a);
                v.AddMember("size", e.size, a);
                v.AddMember("originalSize", e.original_size, a);
                v.AddMember("storage", e.storage, a);
                v.AddMember("original", e.original, a);
                v.AddMember("backup", static_cast<uint64_t>(e.backup), a);
                list.PushBack(v, a);
            }
            d.AddMember("entries", list, a);
            return serialize(d);
        }
        fs::path original_path(const roots& root, const receipt& r, const entry& e)
        {
            return root.state / utils::string::utf8_to_path(r.generation) / L"originals" / std::to_wstring(e.backup);
        }
        bool uses_storage(const receipt& value)
        {
            return std::any_of(value.entries.begin(), value.entries.end(), [](const entry& e) { return e.storage; });
        }
        void check_storage_owner(const roots& root)
        {
            const auto file = root.storage / L".cb-language-owner.json";
            const auto text = read(file);
            if (text.empty())
            {
                if (exists_file(file))
                    fail("invalid shared language owner record");
                return;
            }
            const auto owner = parse(text);
            if (str(owner, "root") != utils::string::path_to_utf8(root.game))
                fail("another BO1 installation owns the shared Japanese voices; restore its original language first");
        }
        void set_storage_owner(const roots& root, bool owned, bool interrupted = false)
        {
            check_storage_owner(root);
            const auto file = root.storage / L".cb-language-owner.json";
            if (!owned)
            {
                remove_file(file);
                return;
            }
            rapidjson::Document owner;
            owner.SetObject();
            add(owner, "root", utils::string::path_to_utf8(root.game), owner.GetAllocator());
            owner.AddMember("pending", interrupted, owner.GetAllocator());
            write_atomic(file, serialize(owner));
        }

        // Every undo copy and its digest are durable before journal.json appears. Recovery copies
        // (never moves) them, so another crash during rollback can replay the journal again.
        void recover(const roots& root, const std::string& game)
        {
            const auto text = read(root.state / L"journal.json");
            if (text.empty())
            {
                if (exists_file(root.state / L"journal.json"))
                    fail("empty recovery journal; preserve the recovery directory");
                return;
            }
            auto d = parse(text);
            if (str(d, "game") != game || str(d, "root") != utils::string::path_to_utf8(root.game))
                fail("recovery journal belongs to another installation");
            const auto generation = str(d, "generation");
            if (!generation_valid(generation))
                fail("invalid recovery directory");
            const auto old = str(d, "previous");
            const auto previous = decode_receipt(old, root, game);
            bool storage_used = false;
            if (!d.HasMember("undo") || !d["undo"].IsArray() || d["undo"].Size() > 8192)
                fail("invalid rollback list");
            std::set<std::string> seen;
            // Validate all backup bytes and paths before restoring anything.
            for (const auto& v : d["undo"].GetArray())
            {
                const auto p = str(v, "path");
                const bool storage = boolean(v, "storage");
                const auto index = number(v, "index");
                storage_used |= storage;
                if (index >= 8192 || !detail::safe_relative(p) || !allowed_any(game, p, storage) ||
                    !seen.insert((storage ? "s:" : "g:") + lower(p)).second)
                    fail("invalid rollback path");
                (void)root.live(p, storage);
                if (storage && str(d, "storageRoot") != utils::string::path_to_utf8(root.storage))
                    fail("Plutonium storage moved during rollback");
                if (boolean(v, "existed"))
                {
                    const auto h = str(v, "hash");
                    if (!hash_valid(h))
                        fail("invalid rollback hash");
                    require_hash(root.state / utils::string::utf8_to_path(generation) / L"undo" /
                                     std::to_wstring(index),
                                 h, number(v, "size"));
                }
                const auto after = str(v, "afterHash");
                if (!after.empty() && !hash_valid(after))
                    fail("invalid intended rollback hash");
                const auto live = root.live(p, storage);
                if (exists_file(live))
                {
                    const auto actual = hash_file(live);
                    const bool before_matches =
                        boolean(v, "existed") &&
                        actual == std::pair<std::string, uint64_t>{str(v, "hash"), number(v, "size")};
                    const bool after_matches =
                        !after.empty() && actual == std::pair<std::string, uint64_t>{after, number(v, "afterSize")};
                    if (!before_matches && !after_matches)
                        fail("a file changed after an interrupted operation; preserve it before recovery: " + p);
                }
            }
            for (const auto& v : d["undo"].GetArray())
            {
                const auto target = root.live(str(v, "path"), boolean(v, "storage"));
                if (boolean(v, "existed"))
                    copy_checked(root.state / utils::string::utf8_to_path(generation) / L"undo" /
                                     std::to_wstring(number(v, "index")),
                                 target);
                else
                    remove_file(target);
            }
            if (old.empty())
                remove_file(root.state / L"installed.json");
            else
                write_atomic(root.state / L"installed.json", old);
            if (storage_used)
                set_storage_owner(root, uses_storage(previous));
            remove_file(root.state / L"journal.json");
            remove_tree(root.state / utils::string::utf8_to_path(generation));
        }
        struct state_lock
        {
            HANDLE handle = INVALID_HANDLE_VALUE;
            explicit state_lock(const roots& r) : state_lock(r.state / L"lock")
            {
            }
            explicit state_lock(const fs::path& p)
            {
                directories(p.parent_path());
                safe_path(p);
                handle = CreateFileW(p.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_ALWAYS,
                                     FILE_ATTRIBUTE_NORMAL, nullptr);
                if (handle == INVALID_HANDLE_VALUE)
                    fail("another language operation is active, or state is not writable");
            }
            ~state_lock()
            {
                if (handle != INVALID_HANDLE_VALUE)
                    CloseHandle(handle);
            }
        };

        struct transfer
        {
            std::ofstream* file = nullptr;
            std::string* text = nullptr;
            digest hash;
            uint64_t received = 0, limit = 0;
            updater::ui_progress_listener* listener = nullptr;
            const updater::file_info* info = nullptr;
            std::exception_ptr error;
        };
#ifdef CB_LANGUAGE_TESTS
        // Compiled only by the standalone fixture runner. Production always uses the
        // pinned public inventories and real HTTPS transport below.
        std::function<void(const std::string&, transfer&)> fixture_transport;
        std::string fixture_inventory_hash;
        std::function<void(size_t)> fixture_after_mutation;
        std::function<void()> fixture_after_commit;
        bool fixture_leave_journal = false;
#endif
        size_t receive(char* data, size_t size, size_t count, void* context)
        {
            auto& t = *static_cast<transfer*>(context);
            try
            {
                if (size && count > std::numeric_limits<size_t>::max() / size)
                    fail("download size overflow");
                const auto bytes = size * count;
                if (bytes > t.limit - t.received)
                    fail("download exceeds its reviewed size");
                check_cancel(*t.listener);
                if (t.file)
                {
                    t.file->write(data, static_cast<std::streamsize>(bytes));
                    if (!*t.file)
                        fail("cannot write download; check free disk space");
                }
                else
                    t.text->append(data, bytes);
                t.hash.update(data, bytes);
                t.received += bytes;
                if (t.info)
                    t.listener->file_progress(*t.info, static_cast<size_t>(t.received));
                return bytes;
            }
            catch (...)
            {
                t.error = std::current_exception();
                return 0;
            }
        }
        int progress(void* context, curl_off_t, curl_off_t, curl_off_t, curl_off_t)
        {
            auto& t = *static_cast<transfer*>(context);
            try
            {
                check_cancel(*t.listener);
                return 0;
            }
            catch (...)
            {
                t.error = std::current_exception();
                return 1;
            }
        }
        void request(const std::string& url, transfer& t)
        {
#ifdef CB_LANGUAGE_TESTS
            if (!fixture_transport)
                fail("fixture transport is missing");
            fixture_transport(url, t);
            return;
#else
            auto* curl = curl_easy_init();
            if (!curl)
                fail("cannot start download");
            curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
            curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 0L);
            curl_easy_setopt(curl, CURLOPT_PROTOCOLS_STR, "https");
            curl_easy_setopt(curl, CURLOPT_REDIR_PROTOCOLS_STR, "https");
            curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 30L);
            curl_easy_setopt(curl, CURLOPT_LOW_SPEED_LIMIT, 1024L);
            curl_easy_setopt(curl, CURLOPT_LOW_SPEED_TIME, 60L);
            curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, receive);
            curl_easy_setopt(curl, CURLOPT_WRITEDATA, &t);
            curl_easy_setopt(curl, CURLOPT_XFERINFOFUNCTION, progress);
            curl_easy_setopt(curl, CURLOPT_XFERINFODATA, &t);
            curl_easy_setopt(curl, CURLOPT_NOPROGRESS, 0L);
            const auto code = curl_easy_perform(curl);
            long status = 0;
            curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);
            curl_easy_cleanup(curl);
            if (t.error)
                std::rethrow_exception(t.error);
            if (code != CURLE_OK || status != 200)
                fail("Fast DL request failed (HTTP " + std::to_string(status) + ")");
#endif
        }
        struct asset
        {
            entry item;
            std::string url;
        };
        std::vector<asset> inventory(const pack& p, updater::ui_progress_listener& listener)
        {
            const std::string base = std::string(host) + en_game(p.game) + "/" + p.locale + "/launcher-v1/";
            std::string text;
            transfer t;
            t.text = &text;
            t.limit = metadata_limit;
            t.listener = &listener;
            request(base + "inventory.json", t);
            const std::string expected_hash =
#ifdef CB_LANGUAGE_TESTS
                fixture_inventory_hash.empty() ? p.hash : fixture_inventory_hash;
#else
                p.hash;
#endif
            if (t.hash.finish() != expected_hash)
                fail("published inventory changed; CB must review an updated language catalogue first");
            auto d = parse(text);
            const auto id =
                "en-" + en_game(p.game) +
                (std::string_view(p.value) == "ja" ? "-japanese-voices" : "-language-" + std::string(p.language));
            if (str(d, "game") != en_game(p.game) || str(d, "locale") != p.locale || str(d, "language") != p.language ||
                str(d, "packId") != id || !d.HasMember("files") || !d["files"].IsArray() || d["files"].Empty() ||
                d["files"].Size() > 4096)
                fail("inventory identity is invalid");
            std::vector<asset> files;
            std::set<std::string> seen;
            uint64_t bytes = 0;
            bool config = false;
            for (const auto& value : d["files"].GetArray())
            {
                asset file;
                file.item.path = str(value, "path");
                file.item.hash = str(value, "sha256");
                file.item.size = number(value, "size");
                file.item.storage = std::string_view(p.game) == "t5" && std::string_view(p.value) == "ja";
                if (!detail::allowed_path(p.game, p.value, file.item.path) || !hash_valid(file.item.hash) ||
                    file.item.size > pack_limit - bytes || !seen.insert(lower(file.item.path)).second)
                    fail("inventory has an unsafe path, duplicate or invalid size/hash");
                bytes += file.item.size;
                config |=
                    file.item.path == (std::string_view(p.game) == "t6" ? "localization_zm.txt" : "localization.txt");
                file.url = base + "files/" + utils::string::url_encode_path(file.item.path);
                files.push_back(std::move(file));
            }
            if (std::string_view(p.value) != "ja" && !config)
                fail("inventory has no language settings");
            return files;
        }
        void complete_base(const roots& root, const std::string& game)
        {
            const auto names = game == "t4"   ? std::vector<std::string>{"CoDWaW.exe", "main/iw_00.iwd"}
                               : game == "t5" ? std::vector<std::string>{"BlackOps.exe", "zone/Common/common.ff"}
                                              : std::vector<std::string>{"t6zm.exe", "zone/all/zm_transit.ff"};
            for (const auto& name : names)
                if (!exists_file(root.game / utils::string::utf8_to_path(name)))
                    fail("locate a complete game installation before applying a language");
        }
        std::vector<entry> english_conflicts(const roots& root, const std::string& game)
        {
            std::vector<entry> result;
            if (game != "t4" && game != "t5")
                return result;
            const auto main = root.game / L"main";
            safe_path(main);
            if (fs::exists(main))
                for (const auto& e : fs::directory_iterator(main))
                {
                    const auto name = utils::string::path_to_utf8(e.path().filename());
                    if (std::regex_match(lower(name), std::regex("localized_english_iw[0-9]+\\.iwd")))
                    {
                        if (!exists_file(e.path()))
                            fail("invalid English language file");
                        entry value;
                        value.path = "main/" + name;
                        result.push_back(value);
                    }
                }
            const auto zone = root.game / L"zone";
            safe_path(zone);
            if (fs::exists(zone))
                for (const auto& dir : fs::directory_iterator(zone))
                    if (lower(utils::string::path_to_utf8(dir.path().filename())) == "english")
                    {
                        safe_path(dir.path());
                        if (!fs::is_directory(dir))
                            fail("invalid English zone directory");
                        for (const auto& e : fs::directory_iterator(dir))
                        {
                            const auto name = utils::string::path_to_utf8(e.path().filename());
                            if (!std::regex_match(lower(name), std::regex("[a-z0-9_-]+\\.ff")) ||
                                !exists_file(e.path()))
                                fail("unrecognized English zone content; preserve it before changing language");
                            entry value;
                            value.path = "zone/" + utils::string::path_to_utf8(dir.path().filename()) + "/" + name;
                            result.push_back(value);
                        }
                    }
            return result;
        }
    } // namespace

    namespace detail
    {
        bool safe_relative(std::string_view value)
        {
            if (value.empty() || value.size() > 240 || value.front() == '/' || value.back() == '/')
                return false;
            size_t start = 0;
            for (size_t i = 0; i <= value.size(); ++i)
                if (i == value.size() || value[i] == '/')
                {
                    const auto part = value.substr(start, i - start);
                    if (part.empty() || part == "." || part == ".." || part.back() == '.' || part.back() == ' ')
                        return false;
                    const auto stem = lower(std::string(part.substr(0, part.find('.'))));
                    if (stem == "con" || stem == "nul" || stem == "prn" || stem == "aux" ||
                        std::regex_match(stem, std::regex("(com|lpt)[1-9]")))
                        return false;
                    start = i + 1;
                }
            return std::all_of(value.begin(), value.end(),
                               [](char c)
                               {
                                   return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
                                          c == '/' || c == '_' || c == '-' || c == '.';
                               });
        }
        bool allowed_path(std::string_view game, std::string_view language, std::string_view relative)
        {
            if (!safe_relative(relative))
                return false;
            const auto* p = find_pack(game, language);
            if (!p)
                return false;
            const auto r = lower(std::string(relative));
            if (language == "ja")
                return game == "t5"
                           ? std::regex_match(r, std::regex("english/sound/vox/scripted/(zombie_coast|zombie_pentagon)/"
                                                            "[a-z0-9_]+/[a-z0-9_]+\\.wav"))
                           : game == "t6" && std::regex_match(r, std::regex("sound/"
                                                                            "(zmb_buried|zmb_classic_transit|zmb_nuked_"
                                                                            "real|zmb_tomb_load)\\.english\\.sabs"));
            const auto name = std::string(p->language);
            if (game == "t6")
                return r == "localization_zm.txt" ||
                       std::regex_match(r, std::regex("zone/" + name + "/[a-z0-9_-]+\\.(ff|ipak)")) ||
                       std::regex_match(r, std::regex("sound/[a-z0-9_-]+\\." + name + "\\.(sabs|sabl)"));
            return r == "localization.txt" || std::regex_match(r, std::regex("main/video/[a-z0-9_-]+\\.bik")) ||
                   std::regex_match(r, std::regex("main/localized_" + name + "_iw[0-9]+\\.iwd")) ||
                   std::regex_match(r, std::regex("zone/" + name + "/[a-z0-9_-]+\\.ff"));
        }
        std::string inventory_hash(std::string_view game, std::string_view language)
        {
            const auto* p = find_pack(game, language);
            return p ? p->hash : "";
        }
    } // namespace detail
    bool supported(std::string_view game)
    {
        return game == "t4" || game == "t5" || game == "t6";
    }
    std::vector<option> options(std::string_view game)
    {
        if (!supported(game))
            return {};
        std::vector<option> result{{"source", "Original game files"}, {"en", "English / restore original files"}};
        const std::map<std::string, std::string> labels{{"fr", "French"},
                                                        {"it", "Italian"},
                                                        {"de", "German"},
                                                        {"es", "Spanish (Spain)"},
                                                        {"ko", "Korean text / English audio"},
                                                        {"ja", "Japanese voices (partial; English text)"}};
        for (const auto& p : packs)
            if (game == p.game)
                result.push_back(
                    {p.value, labels.at(p.value) +
                                  (game == "t5" && std::string_view(p.value) == "de" ? " (Austrian variant)" : "")});
        return result;
    }
    std::string installed(const game_config::game_config_t& config)
    {
        if (!supported(config.game_key) || !config.get_install_path())
            return "source";
        roots root(config);
        return load_receipt(root, config.game_key).language;
    }
    bool pending(const game_config::game_config_t& config)
    {
        if (!supported(config.game_key) || !config.get_install_path())
            return false;
        roots root(config);
        if (exists_file(root.state / L"journal.json"))
            return true;
        if (config.game_key == "t5" && !root.storage.empty())
        {
            const auto text = read(root.storage / L".cb-language-owner.json");
            if (!text.empty())
                return boolean(parse(text), "pending");
            if (exists_file(root.storage / L".cb-language-owner.json"))
                fail("empty shared language owner record");
        }
        return false;
    }
    bool owns_path(const game_config::game_config_t& config, const std::string& relative)
    {
        if (!supported(config.game_key) || !config.get_install_path())
            return false;
        // The game updater asks for every manifest entry. Cache the validated receipt by
        // root + file timestamp/size rather than reparsing it thousands of times.
        struct cached
        {
            fs::file_time_type time{};
            uintmax_t size = 0;
            bool present = false;
            std::set<std::string> paths;
        };
        static std::mutex mutex;
        static std::map<std::string, cached> cache;
        std::lock_guard guard(mutex);
        const auto game_root = fs::absolute(*config.get_install_path()).lexically_normal();
        const auto state = game_root / L".cb-language" / L"installed.json";
        safe_path(state);
        const bool present = exists_file(state);
        const auto time = present ? fs::last_write_time(state) : fs::file_time_type{};
        const auto size = present ? fs::file_size(state) : 0;
        auto& saved = cache[config.game_key + ":" + lower(utils::string::path_to_utf8(game_root))];
        if (saved.present != present || saved.time != time || saved.size != size)
        {
            roots root(config);
            const auto r = load_receipt(root, config.game_key);
            saved.paths.clear();
            for (const auto& e : r.entries)
                if (!e.storage)
                    saved.paths.insert(lower(e.path));
            saved.present = present;
            saved.time = time;
            saved.size = size;
        }
        auto path = relative;
        std::replace(path.begin(), path.end(), '\\', '/');
        return saved.paths.count(lower(path)) != 0;
    }

    void apply(const game_config::game_config_t& config, const std::string& language,
               updater::ui_progress_listener& listener)
    {
        const auto& game = config.game_key;
        if (!supported(game))
            fail("currently supported only for BO1, BO2 and World at War");
        const auto* selected = find_pack(game, language);
        if (!selected && language != "source" && language != "en")
            fail("no verified pack is published for this game and language");
        roots root(config);
        state_lock lock(root);
        if (any_game_running(config))
            fail("close the game and Plutonium before changing its language");
        bool storage_operation = game == "t5" && (language == "ja" || uses_storage(load_receipt(root, game)));
        if (game == "t5")
        {
            if (!root.storage.empty())
            {
                const auto owner_text = read(root.storage / L".cb-language-owner.json");
                if (!owner_text.empty())
                {
                    const auto owner = parse(owner_text);
                    if (boolean(owner, "pending") && str(owner, "root") != utils::string::path_to_utf8(root.game))
                        fail("shared Japanese voices need recovery in the original BO1 installation: " +
                             str(owner, "root"));
                }
            }
            const auto journal = read(root.state / L"journal.json");
            if (!journal.empty())
            {
                const auto d = parse(journal);
                if (d.HasMember("undo") && d["undo"].IsArray())
                    for (const auto& v : d["undo"].GetArray())
                        storage_operation |= boolean(v, "storage");
            }
        }
        std::unique_ptr<state_lock> storage_lock;
        if (storage_operation)
        {
            if (root.storage.empty())
                fail("Plutonium storage is unavailable");
            storage_lock = std::make_unique<state_lock>(root.storage / L".cb-language.lock");
            check_storage_owner(root);
        }
        recover(root, game);
        check_cancel(listener);
        const auto previous = load_receipt(root, game);
        if (selected)
            complete_base(root, game);
        std::map<std::string, entry> old;
        for (const auto& e : previous.entries)
            old.emplace(key(e), e);
        // Reject a non-English base before fetching a Japanese asset or inventory.
        if (selected && language == "ja")
        {
            const auto name = game == "t6" ? "localization_zm.txt" : "localization.txt";
            entry e;
            e.path = name;
            fs::path source = root.game / utils::string::utf8_to_path(name);
            const auto found = old.find(key(e));
            if (found != old.end())
            {
                if (!found->second.original)
                    fail("Japanese voices require an English base installation");
                source = original_path(root, previous, found->second);
                require_hash(source, found->second.original_hash, found->second.original_size);
            }
            const auto text = read(source);
            const auto first = lower(text.substr(0, text.find_first_of("\r\n")));
            if (first != "english")
                fail("Japanese voices require a complete English base installation; text remains English");
        }
        auto assets = selected ? inventory(*selected, listener) : std::vector<asset>{};
        const auto nonce = std::chrono::steady_clock::now().time_since_epoch().count();
        receipt next;
        next.language = selected ? language : "source";
        next.generation = "generation-" + std::to_string(GetCurrentProcessId()) + "-" + std::to_string(nonce);
        const auto generation = root.state / utils::string::utf8_to_path(next.generation);
        directories(generation / L"stage");
        directories(generation / L"originals");
        directories(generation / L"undo");
        bool journal_written = false, committed = false;
        try
        {
            std::map<std::string, fs::path> stages;
            std::vector<updater::file_info> progress_files;
            for (const auto& a : assets)
                progress_files.push_back({a.item.path, static_cast<size_t>(a.item.size), a.item.hash});
            listener.update_files(progress_files, updater::progress_mode::downloading);
            for (size_t i = 0; i < assets.size(); ++i)
            {
                check_cancel(listener);
                const auto& a = assets[i];
                const auto staged = generation / L"stage" / std::to_wstring(i);
                safe_path(staged);
                std::ofstream out(staged, std::ios::binary | std::ios::trunc);
                if (!out)
                    fail("cannot create staged file");
                listener.begin_file(progress_files[i]);
                transfer t;
                t.file = &out;
                t.limit = a.item.size;
                t.listener = &listener;
                t.info = &progress_files[i];
                request(a.url, t);
                out.flush();
                if (!out)
                    fail("cannot flush staged download");
                out.close();
                if (t.received != a.item.size || t.hash.finish() != a.item.hash)
                    fail("download failed size/SHA-256 verification: " + a.item.path);
                durable(staged);
                stages.emplace(key(a.item), staged);
                next.entries.push_back(a.item);
                listener.end_file(progress_files[i]);
            }
            if (selected && language != "ja")
                for (const auto& e : english_conflicts(root, game))
                    next.entries.push_back(e);
            // Conflicts hidden by the previous language remain hidden when switching language packs.
            if (selected && language != "ja")
                for (const auto& e : previous.entries)
                    if (e.hash.empty() && std::none_of(next.entries.begin(), next.entries.end(),
                                                       [&](const entry& n) { return key(n) == key(e); }))
                    {
                        auto value = e;
                        value.original = false;
                        value.original_hash.clear();
                        next.entries.push_back(value);
                    }
            // Reject changes to managed files before undo capture. Never silently overwrite user edits.
            for (const auto& e : previous.entries)
            {
                check_cancel(listener);
                const auto live = root.live(e.path, e.storage);
                if (e.hash.empty())
                {
                    if (exists_file(live))
                        fail("a managed English override changed; preserve it before restoring");
                }
                else if (exists_file(live) &&
                         hash_file(live, &listener) != std::pair<std::string, uint64_t>{e.hash, e.size})
                    fail("a managed language file changed; preserve it before restoring: " + e.path);
                if (e.original)
                    require_hash(original_path(root, previous, e), e.original_hash, e.original_size);
            }
            std::set<std::string> next_seen;
            for (size_t i = 0; i < next.entries.size(); ++i)
            {
                auto& e = next.entries[i];
                if (!next_seen.insert(key(e)).second)
                    fail("duplicate target path");
                e.backup = i;
                const auto found = old.find(key(e));
                fs::path source;
                if (found != old.end())
                {
                    e.original = found->second.original;
                    if (e.original)
                        source = original_path(root, previous, found->second);
                }
                else
                {
                    source = root.live(e.path, e.storage);
                    e.original = exists_file(source);
                }
                if (e.original)
                {
                    check_cancel(listener);
                    const auto digest = hash_file(source, &listener);
                    e.original_hash = digest.first;
                    e.original_size = digest.second;
                    copy_checked(source, original_path(root, next, e));
                    require_hash(original_path(root, next, e), e.original_hash, e.original_size);
                }
            }
            std::map<std::string, entry> touched = old;
            for (const auto& e : next.entries)
                touched.insert_or_assign(key(e), e);
            // Stage old-only restorations too; original backups survive until the receipt commits.
            for (const auto& [k, e] : old)
                if (!next_seen.count(k) && e.original)
                {
                    const auto staged = generation / L"stage" / (L"restore-" + std::to_wstring(e.backup));
                    copy_checked(original_path(root, previous, e), staged);
                    stages.emplace(k, staged);
                }
            rapidjson::Document journal;
            journal.SetObject();
            auto& allocator = journal.GetAllocator();
            add(journal, "game", game, allocator);
            add(journal, "root", utils::string::path_to_utf8(root.game), allocator);
            add(journal, "storageRoot", utils::string::path_to_utf8(root.storage), allocator);
            add(journal, "generation", next.generation, allocator);
            add(journal, "previous", previous.text, allocator);
            rapidjson::Value undo(rapidjson::kArrayType);
            size_t index = 0;
            for (const auto& [k, e] : touched)
            {
                check_cancel(listener);
                const auto target = root.live(e.path, e.storage);
                const bool existed = exists_file(target);
                rapidjson::Value value(rapidjson::kObjectType);
                add(value, "path", e.path, allocator);
                value.AddMember("storage", e.storage, allocator);
                value.AddMember("index", static_cast<uint64_t>(index), allocator);
                value.AddMember("existed", existed, allocator);
                if (existed)
                {
                    const auto h = hash_file(target, &listener);
                    copy_checked(target, generation / L"undo" / std::to_wstring(index));
                    require_hash(generation / L"undo" / std::to_wstring(index), h.first, h.second);
                    add(value, "hash", h.first, allocator);
                    value.AddMember("size", h.second, allocator);
                }
                const auto staged = stages.find(k);
                const auto after = staged == stages.end() ? std::pair<std::string, uint64_t>{"", 0}
                                                          : hash_file(staged->second, &listener);
                add(value, "afterHash", after.first, allocator);
                value.AddMember("afterSize", after.second, allocator);
                undo.PushBack(value, allocator);
                ++index;
            }
            check_cancel(listener);
            if (any_game_running(config))
                fail("close the game before changing its language");
            journal.AddMember("undo", undo, allocator);
            write_atomic(root.state / L"journal.json", serialize(journal));
            journal_written = true;
            if (storage_operation)
                set_storage_owner(root, true, true);
            size_t mutations = 0;
            for (const auto& [k, e] : touched)
            {
                check_cancel(listener);
                const auto target = root.live(e.path, e.storage);
                const auto staged = stages.find(k);
                if (staged != stages.end())
                    copy_checked(staged->second, target);
                else
                    remove_file(target);
#ifdef CB_LANGUAGE_TESTS
                if (fixture_after_mutation)
                    fixture_after_mutation(++mutations);
#else
                ++mutations;
#endif
            }
            if (selected)
                write_atomic(root.state / L"installed.json", receipt_text(root, game, next));
            else
                remove_file(root.state / L"installed.json");
            if (storage_operation)
                set_storage_owner(root, selected && language == "ja");
            remove_file(root.state / L"journal.json");
            journal_written = false;
            committed = true;
#ifdef CB_LANGUAGE_TESTS
            if (fixture_after_commit)
                fixture_after_commit();
#endif
            // Only unreferenced, checked trees are removed. A failed cleanup is surfaced, never hidden.
            remove_tree(generation / L"stage");
            remove_tree(generation / L"undo");
            if (!selected)
                remove_tree(generation);
            if (!previous.generation.empty())
                remove_tree(root.state / utils::string::utf8_to_path(previous.generation));
        }
        catch (...)
        {
#ifdef CB_LANGUAGE_TESTS
            if (fixture_leave_journal)
                throw;
#endif
            const auto error = std::current_exception();
            if (journal_written)
            {
                try
                {
                    recover(root, game);
                }
                catch (const std::exception& e)
                {
                    fail(std::string("rollback needs recovery; launch is blocked. Retry the language operation: ") +
                         e.what());
                }
            }
            else if (!committed)
            {
                try
                {
                    remove_tree(generation);
                }
                catch (...)
                { /* Keep original failure; uncommitted staged files are harmless. */
                }
            }
            std::rethrow_exception(error);
        }
    }
} // namespace game_languages
