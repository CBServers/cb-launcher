#include "std_include.hpp"
#include "workshop_catalog.hpp"

#include <utils/http.hpp>
#include <utils/logger.hpp>
#include <utils/service_hosts.hpp>

namespace mods::workshop_catalog
{
    namespace
    {
        constexpr int REQUEST_TIMEOUT_SECONDS = 15;
        constexpr uint32_t REQUEST_RETRIES = 1;

        std::string json_string(const rapidjson::Value& value, const char* key)
        {
            return value.HasMember(key) && value[key].IsString() ? value[key].GetString() : std::string{};
        }

        uint64_t json_size(const rapidjson::Value& value, const char* key)
        {
            if (!value.HasMember(key))
            {
                return 0;
            }

            const auto& v = value[key];
            if (v.IsUint64())
            {
                return v.GetUint64();
            }
            if (v.IsDouble() && v.GetDouble() > 0)
            {
                return static_cast<uint64_t>(v.GetDouble());
            }
            return 0;
        }
    }

    std::optional<item> fetch(const game_config::game_config_t& config, const std::string& workshop_id)
    {
        using utils::service_hosts::service;

        const auto path = "/v1/item?game=" + config.game_key + "&id=" + workshop_id;
        const auto url = utils::service_hosts::active(service::workshop) + path;
        const auto result = utils::service_hosts::with_failover(service::workshop, url, [](const std::string& target)
        {
            return utils::http::get_data(target, {}, {}, {}, REQUEST_TIMEOUT_SECONDS, REQUEST_RETRIES);
        });

        if (!result || result->code != CURLE_OK || result->response_code < 200 || result->response_code >= 300)
        {
            utils::logger::write("[cbl-mods] workshop item {} lookup failed (curl {}, http {})", workshop_id,
                                 result ? static_cast<int>(result->code) : -1, result ? result->response_code : 0);
            return std::nullopt;
        }

        rapidjson::Document doc;
        doc.Parse(result->buffer.data(), result->buffer.size());
        if (doc.HasParseError() || !doc.IsObject() || json_string(doc, "id") != workshop_id)
        {
            return std::nullopt;
        }

        item out{};
        out.id = workshop_id;
        out.title = json_string(doc, "title");
        out.kind = json_string(doc, "kind");
        out.size = json_size(doc, "size");

        if (doc.HasMember("children") && doc["children"].IsArray())
        {
            for (const auto& entry : doc["children"].GetArray())
            {
                if (!entry.IsObject())
                {
                    continue;
                }

                child c{};
                c.id = json_string(entry, "id");
                c.title = json_string(entry, "title");
                c.size = json_size(entry, "size");
                if (!c.id.empty())
                {
                    out.children.push_back(std::move(c));
                }
            }
        }

        return out;
    }
}
