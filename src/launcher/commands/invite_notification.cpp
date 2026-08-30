#include "std_include.hpp"
#include "invite_notification.hpp"
#include "cef/cef_ui.hpp"
#include "discord/avatar_cache.hpp"

#include <utils/notification.hpp>
#include <utils/properties.hpp>
#include <utils/property_keys.hpp>
#include <utils/string.hpp>

namespace commands::invite_notification
{
    namespace
    {
        std::mutex active_toasts_mutex;
        std::unordered_map<std::string, int64_t> active_toasts; // invite id -> live toast id

        // The game art already ships with the UI, so the toast costs the updater nothing.
        std::filesystem::path hero_image_for(const std::string& game_id)
        {
            // The id doubles as the asset folder name; keep it strict so it can't walk the tree.
            std::string slug;
            for (const char c : game_id)
            {
                const auto lc = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
                if ((lc >= 'a' && lc <= 'z') || (lc >= '0' && lc <= '9') || lc == '-') slug.push_back(lc);
            }

            if (slug.empty() || slug != game_id)
            {
                return {};
            }

            const auto path = utils::properties::get_appdata_path() / "data" / "launcher-ui" / "assets" /
                "img" / "games" / utils::string::utf8_to_path(slug) / "hero.jpg";

            std::error_code ec;
            return std::filesystem::is_regular_file(path, ec) ? path : std::filesystem::path{};
        }

        void show_toast(cef::cef_ui* cef_ui, std::string id, std::string title, std::string body,
                        std::filesystem::path logo, std::filesystem::path hero)
        {
            utils::notification::options options{};
            options.title = std::move(title);
            options.body = std::move(body);
            options.logo = std::move(logo);
            options.hero = std::move(hero);
            options.on_activated = [cef_ui] { cef_ui->bring_to_front(); };

            const auto toast_id = utils::notification::show(options);
            if (toast_id == utils::notification::invalid_id)
            {
                return;
            }

            std::lock_guard lock(active_toasts_mutex);
            active_toasts[std::move(id)] = toast_id;
        }
    }

    bool wanted(const cef::cef_ui& cef_ui)
    {
        if (utils::properties::load(property_keys::DESKTOP_NOTIFICATIONS) == "false")
        {
            return false;
        }

        auto* const window = cef_ui.get_window();
        return !window || GetForegroundWindow() != window;
    }

    void show(cef::cef_ui& cef_ui, std::string id, std::string title, std::string body,
              std::string avatar_url, std::string game_id)
    {
        std::thread([&cef_ui, id = std::move(id), title = std::move(title), body = std::move(body),
                     avatar = std::move(avatar_url), game = std::move(game_id)]
        {
            // Downloading here keeps the UI thread free; the toast fires once the art lands.
            const auto logo = avatar.empty() ? std::filesystem::path{} : discord::avatar_cache::fetch(avatar);

            CefPostTask(TID_UI, base::BindOnce(&show_toast, &cef_ui, id, title, body, logo,
                                               hero_image_for(game)));
        }).detach();
    }

    void dismiss(const std::string& id)
    {
        int64_t toast_id = utils::notification::invalid_id;
        {
            std::lock_guard lock(active_toasts_mutex);
            const auto entry = active_toasts.find(id);
            if (entry == active_toasts.end())
            {
                return;
            }

            toast_id = entry->second;
            active_toasts.erase(entry);
        }

        utils::notification::dismiss(toast_id);
    }
}
