#include "std_include.hpp"

// Standalone fixture executable: compile this file alone with CB_LANGUAGE_TESTS,
// launcher/common/dependency includes, and libtomcrypt. Never link it into CB.
#ifdef CB_LANGUAGE_TESTS
#include "game_languages.cpp"
#include <iostream>

namespace
{
    std::filesystem::path fixture_game, fixture_pluto;
    bool fixture_cancelled = false;
} // namespace
namespace game_config
{
    std::optional<std::filesystem::path> game_config_t::get_install_path() const
    {
        return fixture_game;
    }
    bool is_game_process_running(const std::string&, unsigned int)
    {
        return false;
    }
} // namespace game_config
namespace plutonium
{
    std::filesystem::path get_root()
    {
        return fixture_pluto;
    }
    bool is_game_running()
    {
        return false;
    }
} // namespace plutonium
namespace utils::nt
{
    bool is_any_process_running(const std::vector<std::string>&, unsigned int)
    {
        return false;
    }
} // namespace utils::nt
namespace utils::string
{
    std::filesystem::path utf8_to_path(const std::string& value)
    {
        const int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
                                             static_cast<int>(value.size()), nullptr, 0);
        std::wstring out(size, L'\0');
        MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), out.data(),
                            size);
        return out;
    }
    std::string path_to_utf8(const std::filesystem::path& value)
    {
        const auto wide = value.wstring();
        const int size =
            WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()), nullptr, 0, nullptr, nullptr);
        std::string out(size, '\0');
        WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()), out.data(), size, nullptr, nullptr);
        return out;
    }
    std::string url_encode_path(const std::string& value)
    {
        return value;
    } // Reviewed fixture paths contain only URL-safe ASCII.
} // namespace utils::string
namespace updater
{
    void ui_progress_listener::update_files(const std::vector<file_info>&, progress_mode)
    {
    }
    void ui_progress_listener::wait_if_paused()
    {
    }
    bool ui_progress_listener::is_update_cancelled()
    {
        return fixture_cancelled;
    }
    void ui_progress_listener::begin_file(const file_info&)
    {
    }
    void ui_progress_listener::end_file(const file_info&)
    {
    }
    void ui_progress_listener::file_progress(const file_info&, size_t)
    {
    }
} // namespace updater

int main()
{
    namespace fs = std::filesystem;
    using namespace game_languages;
    size_t assertions = 0;
    auto expect = [&](bool condition, const char* message)
    {
        ++assertions;
        if (!condition)
            throw std::runtime_error(message);
    };
    auto throws = [&](auto fn, const char* message)
    {
        bool thrown = false;
        try
        {
            fn();
        }
        catch (const std::exception&)
        {
            thrown = true;
        }
        expect(thrown, message);
    };
    const auto workspace =
        fs::absolute(fs::path("work") / ("language-fixtures-" + std::to_string(GetCurrentProcessId())))
            .lexically_normal();
    fs::create_directories(workspace);
    auto put = [](const fs::path& p, const std::string& value)
    {
        fs::create_directories(p.parent_path());
        std::ofstream out(p, std::ios::binary);
        out << value;
        if (!out)
            throw std::runtime_error("fixture write failed");
    };
    auto get = [](const fs::path& p)
    {
        std::ifstream in(p, std::ios::binary);
        return std::string(std::istreambuf_iterator<char>(in), {});
    };
    auto sha = [](const std::string& value)
    {
        digest h;
        h.update(value.data(), value.size());
        return h.finish();
    };
    std::map<std::string, std::string> bodies;
    std::string inventory_body;
    size_t requests = 0;
    bool corrupt = false, oversize = false;
    fixture_transport = [&](const std::string& url, transfer& t)
    {
        ++requests;
        std::string body;
        if (url.ends_with("inventory.json"))
            body = inventory_body;
        else
        {
            const auto prefix = url.find("/files/");
            if (prefix == std::string::npos)
                throw std::runtime_error("unexpected fixture URL");
            body = bodies.at(url.substr(prefix + 7));
            if (corrupt && !body.empty())
                body[0] ^= 1;
            if (oversize)
                body += 'x';
        }
        // Chunking exercises streaming and declared-size bounds instead of bulk buffering.
        for (size_t i = 0; i < body.size(); i += 3)
            if (receive(body.data() + i, 1, std::min<size_t>(3, body.size() - i), &t) == 0)
            {
                if (t.error)
                    std::rethrow_exception(t.error);
                throw std::runtime_error("fixture transfer failed");
            }
    };
    updater::ui_progress_listener listener;
    game_config::game_config_t config;
    config.game_key = "t6";
    config.id = "t6";
    auto make_inventory =
        [&](const std::string& game, const std::string& locale, const std::string& language, const std::string& id)
    {
        rapidjson::Document d;
        d.SetObject();
        auto& a = d.GetAllocator();
        add(d, "game", game, a);
        add(d, "locale", locale, a);
        add(d, "language", language, a);
        add(d, "packId", id, a);
        rapidjson::Value files(rapidjson::kArrayType);
        for (const auto& [path, body] : bodies)
        {
            rapidjson::Value f(rapidjson::kObjectType);
            add(f, "path", path, a);
            add(f, "sha256", sha(body), a);
            f.AddMember("size", static_cast<uint64_t>(body.size()), a);
            files.PushBack(f, a);
        }
        d.AddMember("files", files, a);
        inventory_body = serialize(d);
        fixture_inventory_hash = sha(inventory_body);
    };
    auto setup = [&](const std::string& name, const std::string& game = "t6")
    {
        fixture_after_mutation = {};
        fixture_after_commit = {};
        fixture_leave_journal = false;
        fixture_cancelled = false;
        corrupt = false;
        oversize = false;
        requests = 0;
        fixture_game = workspace / name;
        fixture_pluto = workspace / (name + "-pluto");
        config.game_key = game;
        config.id = game;
        fs::create_directories(fixture_game);
        fs::create_directories(fixture_pluto);
        if (game == "t6")
        {
            put(fixture_game / "t6zm.exe", "exe");
            put(fixture_game / "zone/all/zm_transit.ff", "base");
            put(fixture_game / "localization_zm.txt", "english\n");
            bodies = {{"localization_zm.txt", "spanish\n"}, {"zone/spanish/sp_ui_zm.ff", "Spanish UI"}};
        }
        else
        {
            put(fixture_game / "BlackOps.exe", "exe");
            put(fixture_game / "zone/Common/common.ff", "base");
            put(fixture_game / "localization.txt", "english\n");
            put(fixture_game / "main/localized_English_iw00.iwd", "English IWD");
            put(fixture_game / "zone/english/en_ui.ff", "English UI");
            bodies = {{"localization.txt", "french\n"}, {"zone/french/fr_ui.ff", "French UI"}};
        }
        make_inventory(game == "t6" ? "bo2" : "bo1", game == "t6" ? "es-ES" : "fr-FR",
                       game == "t6" ? "spanish" : "french",
                       game == "t6" ? "en-bo2-language-spanish" : "en-bo1-language-french");
    };
    try
    {
        expect(supported("t4") && supported("t5") && supported("t6") && !supported("bo3"),
               "supported games are restricted");
        expect(options("bo3").empty(), "BO3 has no language settings");
        for (const auto& path : {"../outside", "/outside", "C:/outside", "main\\outside", "main/nul.ff", "main/a..",
                                 "main/a:stream", "main//b"})
            expect(!detail::safe_relative(path), "unsafe path accepted");
        expect(detail::allowed_path("t6", "es", "zone/spanish/sp_ui_zm.ff"), "selected language path rejected");
        expect(!detail::allowed_path("t6", "es", "zone/english/en_ui_zm.ff"), "other-language path accepted");
        expect(!detail::allowed_path("t6", "es", "t6zm.exe"), "executable accepted");
        expect(!detail::inventory_hash("t5", "de").empty(), "BO1 German pin missing");
        setup("success");
        apply(config, "es", listener);
        expect(installed(config) == "es", "receipt selection missing");
        expect(owns_path(config, "localization_zm.txt"), "updater does not protect selected language");
        expect(get(fixture_game / "localization_zm.txt") == "spanish\n", "language not installed");
        expect(get(fixture_game / "t6zm.exe") == "exe", "base executable changed");
        apply(config, "en", listener);
        expect(get(fixture_game / "localization_zm.txt") == "english\n", "original language not restored");
        expect(!fs::exists(fixture_game / "zone/spanish/sp_ui_zm.ff"), "new language asset not removed");
        expect(installed(config) == "source", "restored receipt remains");
        setup("corrupt");
        corrupt = true;
        throws([&] { apply(config, "es", listener); }, "SHA mismatch accepted");
        expect(get(fixture_game / "localization_zm.txt") == "english\n", "corrupt download changed live config");
        expect(!pending(config), "failed download left live journal");
        setup("oversize");
        oversize = true;
        throws([&] { apply(config, "es", listener); }, "oversized download accepted");
        expect(get(fixture_game / "localization_zm.txt") == "english\n", "oversized download changed live files");
        setup("bad-pin");
        fixture_inventory_hash = std::string(64, '0');
        throws([&] { apply(config, "es", listener); }, "changed inventory pin accepted");
        expect(get(fixture_game / "localization_zm.txt") == "english\n", "inventory mismatch changed live files");
        setup("modified");
        apply(config, "es", listener);
        put(fixture_game / "localization_zm.txt", "my edited config");
        throws([&] { apply(config, "source", listener); }, "modified asset was overwritten");
        expect(get(fixture_game / "localization_zm.txt") == "my edited config", "edited bytes lost");
        expect(installed(config) == "es", "modified receipt lost");
        setup("missing");
        apply(config, "es", listener);
        fs::remove(fixture_game / "localization_zm.txt");
        apply(config, "source", listener);
        expect(get(fixture_game / "localization_zm.txt") == "english\n", "missing managed asset cannot recover");
        setup("rollback");
        fixture_after_mutation = [](size_t n)
        {
            if (n == 1)
                throw std::runtime_error("fixture disk failure");
        };
        throws([&] { apply(config, "es", listener); }, "commit failure was ignored");
        expect(get(fixture_game / "localization_zm.txt") == "english\n", "commit failure did not rollback");
        expect(!pending(config), "completed rollback journal remains");
        setup("interrupted");
        fixture_leave_journal = true;
        fixture_after_mutation = [](size_t n)
        {
            if (n == 1)
                throw std::runtime_error("fixture process interruption");
        };
        throws([&] { apply(config, "es", listener); }, "interruption did not occur");
        expect(pending(config), "interrupted transaction did not block launch");
        fixture_leave_journal = false;
        fixture_after_mutation = {};
        apply(config, "source", listener);
        expect(get(fixture_game / "localization_zm.txt") == "english\n", "retry did not recover journal");
        expect(!pending(config), "recovered journal remains");
        setup("interrupted-edit");
        fixture_leave_journal = true;
        fixture_after_mutation = [](size_t n)
        {
            if (n == 1)
                throw std::runtime_error("fixture interruption");
        };
        throws([&] { apply(config, "es", listener); }, "interruption did not occur");
        fixture_leave_journal = false;
        fixture_after_mutation = {};
        put(fixture_game / "localization_zm.txt", "manual edit after interruption");
        throws([&] { apply(config, "source", listener); }, "recovery overwrote unknown edits");
        expect(pending(config), "unknown recovery edit did not retain journal");
        expect(get(fixture_game / "localization_zm.txt") == "manual edit after interruption",
               "recovery lost edited bytes");
        put(fixture_game / "localization_zm.txt", "english\n");
        apply(config, "source", listener);
        expect(!pending(config), "recovery could not retry after manual preservation");
        setup("cleanup");
        fixture_after_commit = []() { throw std::runtime_error("fixture cleanup failure"); };
        throws([&] { apply(config, "es", listener); }, "cleanup failure not surfaced");
        expect(installed(config) == "es", "cleanup lost committed receipt");
        fixture_after_commit = {};
        apply(config, "source", listener);
        expect(get(fixture_game / "localization_zm.txt") == "english\n", "cleanup lost originals");
        setup("english-conflicts", "t5");
        apply(config, "fr", listener);
        expect(!fs::exists(fixture_game / "main/localized_English_iw00.iwd"), "English IWD still overrides language");
        expect(!fs::exists(fixture_game / "zone/english/en_ui.ff"), "English FF still overrides language");
        expect(owns_path(config, "main/localized_English_iw00.iwd"), "updater does not protect English backup");
        apply(config, "source", listener);
        expect(get(fixture_game / "main/localized_English_iw00.iwd") == "English IWD", "English IWD not restored");
        expect(get(fixture_game / "zone/english/en_ui.ff") == "English UI", "English FF not restored");
        setup("japanese-base");
        put(fixture_game / "localization_zm.txt", "french\n");
        throws([&] { apply(config, "ja", listener); }, "Japanese accepted non-English base");
        expect(requests == 0, "Japanese base checked after network request");
        setup("shared-japanese", "t5");
        const auto first_root = fixture_game;
        const auto second_root = workspace / "shared-japanese-second";
        put(second_root / "BlackOps.exe", "exe");
        put(second_root / "zone/Common/common.ff", "base");
        put(second_root / "localization.txt", "english\n");
        bodies = {{"english/sound/vox/scripted/zombie_coast/computer/test.wav", "Japanese audio"}};
        make_inventory("bo1", "ja-JP", "japanese", "en-bo1-japanese-voices");
        apply(config, "ja", listener);
        const auto voice = fixture_pluto / "storage/t5/english/sound/vox/scripted/zombie_coast/computer/test.wav";
        expect(get(voice) == "Japanese audio", "BO1 voices installed into wrong root");
        expect(get(first_root / "localization.txt") == "english\n", "Japanese changed English config");
        fixture_game = second_root;
        throws([&] { apply(config, "ja", listener); }, "second BO1 installation captured shared overrides");
        expect(get(voice) == "Japanese audio", "second installation changed shared voices");
        fixture_game = first_root;
        apply(config, "source", listener);
        expect(!fs::exists(voice), "shared original absence not restored");
        fixture_game = second_root;
        apply(config, "ja", listener);
        apply(config, "source", listener);
        expect(!fs::exists(voice), "second root resurrected Japanese override");
        fixture_game = first_root;
        fixture_leave_journal = true;
        fixture_after_mutation = [](size_t n)
        {
            if (n == 1)
                throw std::runtime_error("shared interruption");
        };
        throws([&] { apply(config, "ja", listener); }, "shared interruption failed");
        fixture_game = second_root;
        expect(pending(config), "second BO1 root can launch interrupted shared voices");
        throws([&] { apply(config, "ja", listener); }, "second BO1 root admitted during shared recovery");
        throws([&] { apply(config, "source", listener); }, "second BO1 root falsely reported shared recovery success");
        fixture_game = first_root;
        fixture_leave_journal = false;
        fixture_after_mutation = {};
        apply(config, "source", listener);
        fixture_game = second_root;
        expect(!pending(config), "shared recovery pending marker remains");
        setup("cancelled");
        fixture_cancelled = true;
        throws([&] { apply(config, "es", listener); }, "cancelled operation proceeded");
        expect(get(fixture_game / "localization_zm.txt") == "english\n", "cancellation changed files");
        fixture_cancelled = false;
        setup("reparse");
        const auto outside = workspace / "outside";
        fs::create_directories(outside);
        const auto link = fixture_game / "zone/spanish";
        fs::create_directories(link.parent_path());
        const std::wstring command =
            L"cmd.exe /c mklink /J \"" + link.wstring() + L"\" \"" + outside.wstring() + L"\" >nul";
        if (_wsystem(command.c_str()) != 0)
            throw std::runtime_error("cannot create junction fixture");
        throws([&] { apply(config, "es", listener); }, "junction accepted");
        expect(!fs::exists(outside / "sp_ui_zm.ff"), "junction wrote outside selected root");
        fs::remove(link);
        std::cout << "Language installer fixtures passed: " << assertions << " assertions\n";
        remove_tree(workspace);
        return 0;
    }
    catch (const std::exception& e)
    {
        std::cerr << "Language installer fixture failed after " << assertions << " assertions: " << e.what()
                  << "\nFixture directory: " << workspace << "\n";
        return 1;
    }
}
#endif
