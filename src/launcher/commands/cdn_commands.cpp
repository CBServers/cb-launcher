#include "std_include.hpp"
#include "cdn_commands.hpp"
#include "cef/cef_ui.hpp"

#include <utils/cdn.hpp>

namespace commands::cdn_commands
{
    void register_commands(cef::cef_ui& cef_ui, command_context&)
    {
        cef_ui.add_command("get-cdn-servers", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            auto& cdn = utils::cdn::cdn_manager::instance();
            const auto servers = cdn.get_servers();
            const auto preference = cdn.get_preference();
            const auto& cached_latency = cdn.get_cached_latency();

            // Add preference
            rapidjson::Value pref_value;
            const auto pref_str = utils::cdn::cdn_manager::region_to_string(preference);
            pref_value.SetString(pref_str.data(), static_cast<rapidjson::SizeType>(pref_str.length()), allocator);
            response.AddMember("preference", pref_value, allocator);

            // Add servers array
            rapidjson::Value servers_array(rapidjson::kArrayType);
            for (const auto& server : servers)
            {
                rapidjson::Value server_obj(rapidjson::kObjectType);

                rapidjson::Value region_val;
                const auto region_str = utils::cdn::cdn_manager::region_to_string(server.region);
                region_val.SetString(region_str.data(), static_cast<rapidjson::SizeType>(region_str.length()), allocator);
                server_obj.AddMember("region", region_val, allocator);

                rapidjson::Value name_val;
                name_val.SetString(server.name.data(), static_cast<rapidjson::SizeType>(server.name.length()), allocator);
                server_obj.AddMember("name", name_val, allocator);

                rapidjson::Value url_val;
                url_val.SetString(server.url.data(), static_cast<rapidjson::SizeType>(server.url.length()), allocator);
                server_obj.AddMember("url", url_val, allocator);

                if (server.latency_ms.has_value())
                {
                    server_obj.AddMember("latency", server.latency_ms.value(), allocator);
                }
                else
                {
                    server_obj.AddMember("latency", rapidjson::Value(rapidjson::kNullType), allocator);
                }

                servers_array.PushBack(server_obj, allocator);
            }
            response.AddMember("servers", servers_array, allocator);

            // Add recommended server if latency was tested
            if (cached_latency.success)
            {
                rapidjson::Value rec_val;
                const auto rec_str = utils::cdn::cdn_manager::region_to_string(cached_latency.recommended);
                rec_val.SetString(rec_str.data(), static_cast<rapidjson::SizeType>(rec_str.length()), allocator);
                response.AddMember("recommended", rec_val, allocator);
            }
            else
            {
                response.AddMember("recommended", rapidjson::Value(rapidjson::kNullType), allocator);
            }
        });

        cef_ui.add_command("set-cdn-preference", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetBool(false);

            if (!value.IsObject() || !value.HasMember("region"))
            {
                return;
            }

            const auto region_str = std::string{ value["region"].GetString() };
            const auto region = utils::cdn::cdn_manager::string_to_region(region_str);

            auto& cdn = utils::cdn::cdn_manager::instance();

            // Don't allow switching to "custom" if no URL is configured
            if (region == utils::cdn::cdn_region::custom && cdn.get_custom_url().empty())
            {
                return;
            }

            cdn.set_preference(region);

            response.SetBool(true);
        });

        cef_ui.add_command("set-cdn-custom-url", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            const auto fail = [&](const char* error)
            {
                response.AddMember("success", false, allocator);
                rapidjson::Value err_val;
                err_val.SetString(error, allocator);
                response.AddMember("error", err_val, allocator);
            };

            if (!value.IsObject() || !value.HasMember("url") || !value["url"].IsString())
            {
                fail("missing url");
                return;
            }

            std::string url = value["url"].GetString();

            // Trim whitespace
            const auto first = url.find_first_not_of(" \t\r\n");
            const auto last = url.find_last_not_of(" \t\r\n");
            if (first == std::string::npos)
            {
                url.clear();
            }
            else
            {
                url = url.substr(first, last - first + 1);
            }

            auto& cdn = utils::cdn::cdn_manager::instance();

            if (url.empty())
            {
                cdn.set_custom_url("");
                if (cdn.get_preference() == utils::cdn::cdn_region::custom)
                {
                    cdn.set_preference(utils::cdn::cdn_region::automatic);
                }
                response.AddMember("success", true, allocator);
                return;
            }

            const bool valid_prefix =
                url.rfind("http://", 0) == 0 || url.rfind("https://", 0) == 0;
            if (!valid_prefix)
            {
                fail("URL must start with http:// or https://");
                return;
            }

            // Ensure a trailing slash so callers can concatenate paths safely
            if (url.back() != '/')
            {
                url.push_back('/');
            }

            cdn.set_custom_url(url);
            response.AddMember("success", true, allocator);
        });

        cef_ui.add_command("test-cdn-latency", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            auto& cdn = utils::cdn::cdn_manager::instance();
            const auto result = cdn.test_all_latencies();

            response.AddMember("success", result.success, allocator);

            // Add servers array with latencies
            rapidjson::Value servers_array(rapidjson::kArrayType);
            for (const auto& server : result.servers)
            {
                rapidjson::Value server_obj(rapidjson::kObjectType);

                rapidjson::Value region_val;
                const auto region_str = utils::cdn::cdn_manager::region_to_string(server.region);
                region_val.SetString(region_str.data(), static_cast<rapidjson::SizeType>(region_str.length()), allocator);
                server_obj.AddMember("region", region_val, allocator);

                rapidjson::Value name_val;
                name_val.SetString(server.name.data(), static_cast<rapidjson::SizeType>(server.name.length()), allocator);
                server_obj.AddMember("name", name_val, allocator);

                if (server.latency_ms.has_value())
                {
                    server_obj.AddMember("latency", server.latency_ms.value(), allocator);
                }
                else
                {
                    server_obj.AddMember("latency", rapidjson::Value(rapidjson::kNullType), allocator);
                }

                servers_array.PushBack(server_obj, allocator);
            }
            response.AddMember("servers", servers_array, allocator);

            // Add recommended server
            rapidjson::Value rec_val;
            const auto rec_str = utils::cdn::cdn_manager::region_to_string(result.recommended);
            rec_val.SetString(rec_str.data(), static_cast<rapidjson::SizeType>(rec_str.length()), allocator);
            response.AddMember("recommended", rec_val, allocator);
        });
    }
}
