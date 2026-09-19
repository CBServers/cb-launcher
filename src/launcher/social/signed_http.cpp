#include "std_include.hpp"
#include "signed_http.hpp"
#include "identity.hpp"

#include <utils/cryptography.hpp>
#include <utils/flags.hpp>
#include <utils/service_hosts.hpp>

#include <rapidjson/writer.h>

namespace social::signed_http
{
    namespace
    {
        using utils::service_hosts::service;

        std::optional<std::string> override_url()
        {
            auto url = utils::flags::get_flag_value("cbfriends-url");
            if (!url)
            {
                return std::nullopt;
            }

            while (!url->empty() && url->back() == '/')
            {
                url->pop_back();
            }
            return url;
        }
    }

    std::string base_url()
    {
        return override_url().value_or(utils::service_hosts::active(service::social));
    }

    std::vector<std::string> base_urls()
    {
        if (auto url = override_url())
        {
            return {std::move(*url)};
        }
        return utils::service_hosts::hosts(service::social);
    }

    std::string json_get(const rapidjson::Value& value, const char* key)
    {
        if (value.IsObject() && value.HasMember(key) && value[key].IsString())
        {
            return value[key].GetString();
        }
        return {};
    }

    void add_string(rapidjson::Document& doc, const char* key, const std::string& value)
    {
        rapidjson::Value v;
        v.SetString(value.data(), static_cast<rapidjson::SizeType>(value.size()), doc.GetAllocator());
        doc.AddMember(rapidjson::StringRef(key), v, doc.GetAllocator());
    }

    std::string serialize(const rapidjson::Document& doc)
    {
        rapidjson::StringBuffer buffer;
        rapidjson::Writer<rapidjson::StringBuffer> writer(buffer);
        doc.Accept(writer);
        return std::string(buffer.GetString(), buffer.GetSize());
    }

    std::optional<utils::http::headers> sign_headers(const std::string& body)
    {
        auto& id = identity::instance();
        const auto key_b64 = utils::cryptography::base64::encode(id.public_key());
        const auto sig_b64 = id.sign(body);
        if (key_b64.empty() || sig_b64.empty())
        {
            return std::nullopt;
        }

        return utils::http::headers{
            {"Content-Type", "application/json"},
            {"X-CB-Key", key_b64},
            {"X-CB-Sig", sig_b64},
        };
    }

    std::optional<utils::http::result> post_signed(const std::string& url, const std::string& body,
                                                   const int timeout,
                                                   std::function<bool(size_t, size_t, size_t)> abort)
    {
        const auto headers = sign_headers(body);
        if (!headers)
        {
            return std::nullopt;
        }

        return utils::service_hosts::with_failover(service::social, url, [&](const std::string& target)
        {
            return utils::http::get_data(target, body, *headers, abort, timeout, 1);
        });
    }

    std::optional<rapidjson::Document> post_json(const std::string& url, const std::string& body,
                                                 const int timeout,
                                                 std::function<bool(size_t, size_t, size_t)> abort)
    {
        const auto resp = post_signed(url, body, timeout, std::move(abort));
        if (!resp)
        {
            return std::nullopt;
        }

        rapidjson::Document doc;
        doc.Parse(resp->buffer.data());
        if (resp->response_code != 200 || doc.HasParseError() || !doc.IsObject())
        {
            return std::nullopt;
        }
        return doc;
    }
}
