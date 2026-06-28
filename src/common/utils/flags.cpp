#include "flags.hpp"
#include "string.hpp"
#include "finally.hpp"
#include "nt.hpp"

#include <shellapi.h>
#include <unordered_map>

namespace utils::flags
{
    void parse_flags(std::vector<std::string>& flags)
    {
        int num_args;
        auto* const argv = CommandLineToArgvW(GetCommandLineW(), &num_args);

        if (argv)
        {
            for (auto i = 0; i < num_args; ++i)
            {
                std::wstring wide_flag(argv[i]);
                if (wide_flag[0] == L'-')
                {
                    wide_flag.erase(wide_flag.begin());
                    const auto flag = string::convert(wide_flag);
                    flags.emplace_back(string::to_lower(flag));
                }
            }

            LocalFree(argv);
        }
    }

    namespace
    {
        std::vector<std::string>& enabled_flags()
        {
            static std::vector<std::string> flags = []
            {
                std::vector<std::string> parsed;
                parse_flags(parsed);
                return parsed;
            }();
            return flags;
        }
    }

    std::unordered_map<std::string, std::string> parse_flag_values()
    {
        int num_args{};
        auto* const argv = CommandLineToArgvW(GetCommandLineW(), &num_args);
        const auto _ = finally([&argv]
        {
            if (argv)
            {
                LocalFree(argv);
            }
        });

        std::unordered_map<std::string, std::string> values{};
        for (auto i = 0; argv && i + 1 < num_args; ++i)
        {
            std::wstring wide_flag(argv[i]);
            if (wide_flag.empty() || wide_flag[0] != L'-')
            {
                continue;
            }

            wide_flag.erase(wide_flag.begin());
            auto key = string::to_lower(string::convert(wide_flag));
            values.emplace(std::move(key), string::convert(std::wstring(argv[i + 1])));
        }

        return values;
    }

    bool has_flag(const std::string& flag)
    {
        const auto lower = string::to_lower(flag);
        const auto& flags = enabled_flags();
        return std::ranges::any_of(flags.cbegin(), flags.cend(),
            [&lower](const auto& elem) { return elem == lower; });
    }

    void add_flag(const std::string& flag)
    {
        auto lower = string::to_lower(flag);
        auto& flags = enabled_flags();
        if (std::ranges::none_of(flags.cbegin(), flags.cend(),
            [&lower](const auto& elem) { return elem == lower; }))
        {
            flags.emplace_back(std::move(lower));
        }
    }

    std::optional<std::string> get_flag_value(const std::string& flag)
    {
        static const auto values = parse_flag_values();
        const auto it = values.find(string::to_lower(flag));
        if (it == values.end())
        {
            return std::nullopt;
        }

        return it->second;
    }
}
