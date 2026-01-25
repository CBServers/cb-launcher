#pragma once

namespace commands::property_keys
{
	// Launcher settings
	constexpr const char* CLOSE_ON_LAUNCH = "launcher-close-on-launch";
	constexpr const char* SKIP_HASH_VERIFICATION = "launcher-skip-hash-verification";

	// Game component settings (used with game config get/set)
	constexpr const char* DETECTED_COMPONENTS = "detected-components";
	constexpr const char* SELECTED_COMPONENTS = "selected-components";
	constexpr const char* DISABLE_CB_EXTENSION = "disable-cb-extension";
}
