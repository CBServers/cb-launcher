#include "std_include.hpp"
#include "link_registry.hpp"
#include "discord_constants.hpp"

#include <utils/http.hpp>

namespace discord::link_registry
{
    namespace
    {
        constexpr int REQUEST_TIMEOUT_SECONDS = 10;
        constexpr uint32_t REQUEST_RETRIES = 2;
        constexpr size_t INTERSECT_CHUNK_SIZE = 40;

        utils::http::headers make_headers(const std::string& access_token)
        {
            return {
                {"Authorization", "Bearer " + access_token},
                {"Content-Type", "application/json"},
            };
        }

        bool post(const std::string& path, const std::string& access_token, const std::string& body,
                  std::string* response_body = nullptr)
        {
            const auto result = utils::http::get_data(std::string{LINK_REGISTRY_URL} + path, body.empty() ? "{}" : body,
                                                      make_headers(access_token), {}, REQUEST_TIMEOUT_SECONDS,
                                                      REQUEST_RETRIES);
            if (!result || result->code != CURLE_OK || result->response_code < 200 || result->response_code >= 300)
            {
                return false;
            }

            if (response_body)
            {
                *response_body = result->buffer;
            }

            return true;
        }
    }

    bool register_link(const std::string& access_token)
    {
        return post("/v1/link", access_token, {});
    }

    bool unregister_link(const std::string& access_token)
    {
        return post("/v1/unlink", access_token, {});
    }

    std::optional<std::vector<std::string>> intersect(const std::string& access_token,
                                                      const std::vector<std::string>& ids)
    {
        std::vector<std::string> linked{};

        for (size_t offset = 0; offset < ids.size(); offset += INTERSECT_CHUNK_SIZE)
        {
            const auto end = std::min(offset + INTERSECT_CHUNK_SIZE, ids.size());

            rapidjson::Document request{rapidjson::kObjectType};
            auto& allocator = request.GetAllocator();
            rapidjson::Value ids_array(rapidjson::kArrayType);
            for (auto i = offset; i < end; ++i)
            {
                rapidjson::Value id_value;
                id_value.SetString(ids[i].data(), static_cast<rapidjson::SizeType>(ids[i].size()), allocator);
                ids_array.PushBack(id_value, allocator);
            }
            request.AddMember("ids", ids_array, allocator);

            rapidjson::StringBuffer buffer{};
            rapidjson::Writer<rapidjson::StringBuffer> writer(buffer);
            request.Accept(writer);

            std::string response_body{};
            if (!post("/v1/friends/intersect", access_token, buffer.GetString(), &response_body))
            {
                return {};
            }

            rapidjson::Document response{};
            response.Parse(response_body);
            if (response.HasParseError() || !response.IsObject() || !response.HasMember("linked") ||
                !response["linked"].IsArray())
            {
                return {};
            }

            for (const auto& entry : response["linked"].GetArray())
            {
                if (entry.IsString())
                {
                    linked.emplace_back(entry.GetString());
                }
            }
        }

        return linked;
    }
}
