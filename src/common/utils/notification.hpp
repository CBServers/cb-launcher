#pragma once

#include <cstdint>
#include <filesystem>
#include <functional>
#include <string>

namespace utils::notification
{
    // Windows resolves an unpackaged app's toasts through a Start Menu shortcut stamped with this
    // AUMID, so main.cpp's shortcut stamp and the toast layer must agree on it exactly.
    constexpr const wchar_t* APP_USER_MODEL_ID = L"CBServers.Launcher";
    constexpr const wchar_t* APP_NAME = L"CB Servers Launcher";

    struct options
    {
        std::string title;
        std::string body;
        std::filesystem::path logo; // small square image, circle-cropped
        std::filesystem::path hero; // wide banner above the text
        std::function<void()> on_activated;
    };

    constexpr int64_t invalid_id = -1;

    bool available();

    // Returns invalid_id if the toast could not be shown. Called on the caller's thread;
    // on_activated fires on a WinRT thread, so marshal from there yourself.
    int64_t show(const options& options);
    void dismiss(int64_t id);
}
