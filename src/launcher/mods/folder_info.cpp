#include "std_include.hpp"
#include "folder_info.hpp"
#include "mod_store.hpp"

#include <utils/io.hpp>
#include <utils/string.hpp>

#include <array>

namespace mods
{
    namespace
    {
        constexpr size_t MAX_FILE_SIZE = 64 * 1024;
        constexpr size_t MAX_NAME_LENGTH = 128;
        constexpr size_t MAX_TEXT_LENGTH = 500;

        // One schema under three names: Plutonium T6, h1-mod and S2x.
        constexpr std::array JSON_FILES = {"mod.json", "info.json", "meta.json"};

        bool read_small_file(const std::filesystem::path& file, std::string& data)
        {
            if (!utils::io::file_exists(file) || utils::io::file_size(file) > MAX_FILE_SIZE || !utils::io::read_file(file, &data))
            {
                return false;
            }

            if (data.starts_with("\xEF\xBB\xBF"))
            {
                data.erase(0, 3);
            }

            return !data.empty();
        }

        // One line of display text: whitespace runs collapsed, capped on a UTF-8 boundary. Colour codes stay for the UI to strip.
        std::string clean_text(const std::string_view text, const size_t max_length)
        {
            std::string result{};
            for (const auto c : text)
            {
                if (static_cast<unsigned char>(c) <= ' ' || c == 0x7F)
                {
                    if (!result.empty() && result.back() != ' ')
                    {
                        result.push_back(' ');
                    }
                    continue;
                }

                result.push_back(c);
            }

            if (result.size() > max_length)
            {
                auto cut = max_length;
                while (cut > 0 && (static_cast<unsigned char>(result[cut]) & 0xC0) == 0x80)
                {
                    --cut;
                }

                result = utils::string::trim(std::string_view{result}.substr(0, cut)) + "\xE2\x80\xA6";
            }

            return utils::string::trim(result);
        }

        // Arena fields can be localization keys (MPUI_DESC_MAP_MP_INVASION) only the game can resolve.
        bool is_localize_key(std::string_view text)
        {
            if (text.starts_with('@'))
            {
                text.remove_prefix(1);
            }

            return text.find('_') != std::string_view::npos && std::all_of(text.begin(), text.end(), [](const unsigned char c)
            {
                return std::isupper(c) || std::isdigit(c) || c == '_';
            });
        }

        std::optional<folder_info> read_json_info(const std::filesystem::path& directory)
        {
            constexpr auto flags = rapidjson::kParseCommentsFlag | rapidjson::kParseTrailingCommasFlag |
                                   rapidjson::kParseStopWhenDoneFlag | rapidjson::kParseNumbersAsStringsFlag;

            for (const auto* file : JSON_FILES)
            {
                std::string data{};
                if (!read_small_file(directory / file, data))
                {
                    continue;
                }

                rapidjson::Document doc{};
                doc.Parse<flags>(data.data(), data.size());
                if (doc.HasParseError() || !doc.IsObject())
                {
                    continue;
                }

                folder_info info{
                    clean_text(json_string(doc, "name"), MAX_NAME_LENGTH),
                    clean_text(json_string(doc, "author"), MAX_NAME_LENGTH),
                    clean_text(json_string(doc, "description"), MAX_TEXT_LENGTH),
                    clean_text(json_string(doc, "version"), MAX_NAME_LENGTH),
                };

                if (!info.name.empty())
                {
                    return info;
                }
            }

            return std::nullopt;
        }

        struct arena_token
        {
            std::string text;
            bool quoted{};

            bool is(const char brace) const
            {
                return !quoted && text.size() == 1 && text.front() == brace;
            }
        };

        // Com_Parse style: quoted strings, bare words and braces, with // and /* */ comments skipped.
        std::vector<arena_token> arena_tokens(const std::string_view text)
        {
            std::vector<arena_token> tokens{};
            const auto is_space = [](const char c) { return static_cast<unsigned char>(c) <= ' '; };

            for (size_t i = 0; i < text.size();)
            {
                const auto c = text[i];
                if (is_space(c))
                {
                    ++i;
                }
                else if (text.substr(i, 2) == "//")
                {
                    i = text.find('\n', i);
                }
                else if (text.substr(i, 2) == "/*")
                {
                    const auto end = text.find("*/", i + 2);
                    i = end == std::string_view::npos ? end : end + 2;
                }
                else if (c == '{' || c == '}')
                {
                    tokens.push_back({std::string(1, c), false});
                    ++i;
                }
                else if (c == '"')
                {
                    const auto end = text.find('"', i + 1);
                    tokens.push_back({std::string{text.substr(i + 1, end == std::string_view::npos ? end : end - i - 1)}, true});
                    i = end == std::string_view::npos ? end : end + 1;
                }
                else
                {
                    auto end = i;
                    while (end < text.size() && !is_space(text[end]) && text[end] != '"' && text[end] != '{' && text[end] != '}')
                    {
                        ++end;
                    }

                    tokens.push_back({std::string{text.substr(i, end - i)}, false});
                    i = end;
                }
            }

            return tokens;
        }

        using arena_block = std::unordered_map<std::string, std::string>;

        std::vector<arena_block> parse_arena(const std::string_view text)
        {
            std::vector<arena_block> blocks{};
            const auto tokens = arena_tokens(text);
            for (size_t i = 0; i < tokens.size(); ++i)
            {
                if (!tokens[i].is('{'))
                {
                    continue;
                }

                arena_block block{};
                while (++i < tokens.size() && !tokens[i].is('}'))
                {
                    if (i + 1 < tokens.size() && !tokens[i + 1].is('}'))
                    {
                        block[utils::string::to_lower(tokens[i].text)] = tokens[i + 1].text;
                        ++i;
                    }
                }

                blocks.push_back(std::move(block));
            }

            return blocks;
        }

        // usermaps/<map>/<map>.arena, as iw7-mod, h1-mod and Plutonium IW5 load it; one file can list several maps.
        std::optional<arena_block> read_arena(const std::filesystem::path& directory)
        {
            const auto dirname = utils::string::path_to_utf8(directory.filename());
            for (const auto& base : {directory, directory / "zone"})
            {
                auto file = base / directory.filename();
                file += ".arena";

                std::string data{};
                if (!read_small_file(file, data))
                {
                    continue;
                }

                const auto blocks = parse_arena(data);
                const auto match = std::find_if(blocks.begin(), blocks.end(), [&dirname](const arena_block& block)
                {
                    const auto map = block.find("map");
                    return map != block.end() && utils::string::equals_no_case(map->second, dirname);
                });

                if (match != blocks.end())
                {
                    return *match;
                }

                if (!blocks.empty())
                {
                    return blocks.front();
                }
            }

            return std::nullopt;
        }

        std::string arena_text(const arena_block& block, const std::string& key, const size_t max_length)
        {
            const auto value = block.find(key);
            if (value == block.end())
            {
                return {};
            }

            auto text = clean_text(value->second, max_length);
            return is_localize_key(text) ? std::string{} : text;
        }
    }

    folder_info read_folder_info(const std::filesystem::path& directory)
    {
        auto info = read_json_info(directory).value_or(folder_info{});

        if (const auto arena = read_arena(directory))
        {
            if (info.name.empty())
            {
                info.name = arena_text(*arena, "longname", MAX_NAME_LENGTH);
            }

            if (info.description.empty())
            {
                info.description = arena_text(*arena, "description", MAX_TEXT_LENGTH);
            }
        }

        // iw7-mod's mod menu shows desc.txt as the description and never as the name.
        if (std::string data{}; info.description.empty() && read_small_file(directory / "desc.txt", data))
        {
            info.description = clean_text(data, MAX_TEXT_LENGTH);
        }

        if (utils::string::equals_no_case(info.description, info.name))
        {
            info.description.clear();
        }

        return info;
    }
}
