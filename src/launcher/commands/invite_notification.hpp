#pragma once

#include <string>

namespace cef
{
    class cef_ui;
}

namespace commands::invite_notification
{
    // False when notifications are off or the launcher is already in front, so nothing is announced.
    bool wanted(const cef::cef_ui& cef_ui);

    // Raises a toast for an invite, downloading the sender's avatar off the calling thread first.
    void show(cef::cef_ui& cef_ui, std::string id, std::string title, std::string body,
              std::string avatar_url, std::string game_id);

    // Withdraws a toast raised earlier for this invite id.
    void dismiss(const std::string& id);
}
