#include "string.hpp"
#include <sstream>
#include <cstdarg>
#include <algorithm>

#include "nt.hpp"

namespace utils::string
{
    const char* va(const char* fmt, ...)
    {
        static thread_local va_provider<8, 256> provider;

        va_list ap;
        va_start(ap, fmt);

        const char* result = provider.get(fmt, ap);

        va_end(ap);
        return result;
    }

    std::vector<std::string> split(const std::string& s, const char delim)
    {
        std::stringstream ss(s);
        std::string item;
        std::vector<std::string> elems;

        while (std::getline(ss, item, delim))
        {
            elems.push_back(item); // elems.push_back(std::move(item)); // if C++11 (based on comment from @mchiasson)
        }

        return elems;
    }

    std::string to_lower(const std::string& text)
    {
        std::string result;
        std::ranges::transform(text, std::back_inserter(result), [](const unsigned char input)
        {
            return static_cast<char>(std::tolower(input));
        });

        return result;
    }

    std::string to_upper(const std::string& text)
    {
        std::string result;
        std::ranges::transform(text, std::back_inserter(result), [](const unsigned char input)
        {
            return static_cast<char>(std::toupper(input));
        });

        return result;
    }

    bool starts_with(const std::string& text, const std::string& substring)
    {
        return text.find(substring) == 0;
    }

    bool ends_with(const std::string& text, const std::string& substring)
    {
        if (substring.size() > text.size()) return false;
        return std::equal(substring.rbegin(), substring.rend(), text.rbegin());
    }

    bool equals_no_case(const std::string_view a, const std::string_view b)
    {
        return a.size() == b.size() && std::equal(a.begin(), a.end(), b.begin(), [](const char x, const char y)
        {
            return std::tolower(static_cast<unsigned char>(x)) == std::tolower(static_cast<unsigned char>(y));
        });
    }

    bool starts_with_no_case(const std::string_view text, const std::string_view prefix)
    {
        return text.size() >= prefix.size() && equals_no_case(text.substr(0, prefix.size()), prefix);
    }

    std::string dump_hex(const std::string& data, const std::string& separator)
    {
        std::string result;

        for (unsigned int i = 0; i < data.size(); ++i)
        {
            if (i > 0)
            {
                result.append(separator);
            }

            result.append(va("%02X", data[i] & 0xFF));
        }

        return result;
    }

    std::string get_clipboard_data()
    {
        if (OpenClipboard(nullptr))
        {
            std::string data;

            auto* const clipboard_data = GetClipboardData(1u);
            if (clipboard_data)
            {
                auto* const cliptext = static_cast<char*>(GlobalLock(clipboard_data));
                if (cliptext)
                {
                    data.append(cliptext);
                    GlobalUnlock(clipboard_data);
                }
            }
            CloseClipboard();

            return data;
        }
        return {};
    }

    void strip(const char* in, char* out, int max)
    {
        if (!in || !out) return;

        max--;
        auto current = 0;
        while (*in != 0 && current < max)
        {
            const auto color_index = (*(in + 1) - 48) >= 0xC ? 7 : (*(in + 1) - 48);

            if (*in == '^' && (color_index != 7 || *(in + 1) == '7'))
            {
                ++in;
            }
            else
            {
                *out = *in;
                ++out;
                ++current;
            }

            ++in;
        }
        *out = '\0';
    }

    std::string convert(const std::wstring& wstr)
    {
        if (wstr.empty()) return {};

        const auto size = WideCharToMultiByte(CP_UTF8, 0, wstr.data(), static_cast<int>(wstr.size()),
                                              nullptr, 0, nullptr, nullptr);
        if (size <= 0) return {};

        std::string result(static_cast<size_t>(size), '\0');
        WideCharToMultiByte(CP_UTF8, 0, wstr.data(), static_cast<int>(wstr.size()), result.data(), size, nullptr, nullptr);

        return result;
    }

    std::wstring convert(const std::string& str)
    {
        if (str.empty()) return {};

        const auto size = MultiByteToWideChar(CP_UTF8, 0, str.data(), static_cast<int>(str.size()), nullptr, 0);
        if (size <= 0) return {};

        std::wstring result(static_cast<size_t>(size), L'\0');
        MultiByteToWideChar(CP_UTF8, 0, str.data(), static_cast<int>(str.size()), result.data(), size);

        return result;
    }

    std::filesystem::path utf8_to_path(const std::string& utf8)
    {
        return std::filesystem::path{ convert(utf8) };
    }

    std::string path_to_utf8(const std::filesystem::path& path)
    {
        return convert(path.wstring());
    }

    std::string replace(std::string str, const std::string& from, const std::string& to)
    {
        if (from.empty())
        {
            return str;
        }

        std::size_t start_pos = 0;
        while ((start_pos = str.find(from, start_pos)) != std::string::npos)
        {
            str.replace(start_pos, from.length(), to);
            start_pos += to.length();
        }

        return str;
    }

    std::string url_encode_path(const std::string& path)
    {
        std::string result;
        result.reserve(path.size());

        for (const unsigned char c : path)
        {
            // Keep alphanumeric, hyphen, underscore, period, tilde, and forward slash (path separator)
            if (std::isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~' || c == '/')
            {
                result += static_cast<char>(c);
            }
            else
            {
                // Percent-encode everything else
                result += va("%%%02X", c);
            }
        }

        return result;
    }
}
