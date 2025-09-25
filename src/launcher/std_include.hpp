#ifndef RC_INVOKED

#define _HAS_CXX20 1
#define _HAS_CXX17 1

#ifndef NOMINMAX
#define NOMINMAX
#endif

#include <Windows.h>
#include <ShlObj.h>
#include <dwmapi.h>
#include <ShellScalingApi.h>

#include <atomic>
#include <cstring>
#include <filesystem>
#include <format>
#include <fstream>
#include <functional>
#include <mutex>
#include <regex>
#include <set>
#include <sstream>
#include <string>
#include <unordered_set>
#include <vector>

#include <optional>

#include <rapidjson/document.h>
#include <rapidjson/prettywriter.h>
#include <rapidjson/stringbuffer.h>

#pragma warning(push)
#pragma warning(disable: 4100)

#include <include/base/cef_callback.h>
#include <include/base/cef_bind.h>
#include <include/cef_app.h>
#include <include/cef_base.h>
#include <include/cef_browser.h>
#include <include/cef_client.h>
#include <include/cef_command_line.h>
#include <include/cef_frame.h>
#include <include/cef_scheme.h>
#include <include/cef_parser.h>
#include <include/wrapper/cef_helpers.h>
#include <include/wrapper/cef_closure_task.h>
#include <include/wrapper/cef_stream_resource_handler.h>

#pragma warning(pop)

#pragma comment(lib, "Dwmapi.lib")

#ifdef DEBUG
#define CONFIG_NAME "debug"
#else
#define CONFIG_NAME "release"
#endif

using namespace std::literals;

#endif

// Resources
#define IDI_ICON_1 102
