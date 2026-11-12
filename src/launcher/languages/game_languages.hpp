#pragma once

#include <game_config.hpp>
#include <updater/ui_progress_listener.hpp>
#include <string>
#include <string_view>
#include <vector>

namespace game_languages
{
    struct option
    {
        std::string value, label;
    };

    bool supported(std::string_view game);
    std::vector<option> options(std::string_view game);
    std::string installed(const game_config::game_config_t& config);
    bool pending(const game_config::game_config_t& config);
    bool owns_path(const game_config::game_config_t& config, const std::string& relative);
    void apply(const game_config::game_config_t& config, const std::string& language,
               updater::ui_progress_listener& listener);

    // Pure validation helpers shared by the installer and fixture tests.
    namespace detail
    {
        bool safe_relative(std::string_view value);
        bool allowed_path(std::string_view game, std::string_view language, std::string_view relative);
        std::string inventory_hash(std::string_view game, std::string_view language);
    } // namespace detail
} // namespace game_languages
