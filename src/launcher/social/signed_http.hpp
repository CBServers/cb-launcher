#pragma once

#include <functional>
#include <optional>
#include <string>

#include <rapidjson/document.h>
#include <utils/http.hpp>

// Device-key signed requests against the cbfriends backend, shared by the social service and the
// invite inbox so both speak the same wire format.
namespace social::signed_http
{
    // The backend, honouring -cbfriends-url; trailing slashes stripped.
    std::string base_url();

    std::string json_get(const rapidjson::Value& value, const char* key);
    void add_string(rapidjson::Document& doc, const char* key, const std::string& value);
    std::string serialize(const rapidjson::Document& doc);

    // The three headers that authenticate `body`, or nullopt when the device key is unavailable.
    std::optional<utils::http::headers> sign_headers(const std::string& body);

    // Signs the exact bytes sent; the worker verifies over the same string. `abort` returning false
    // cancels the transfer, which is how a held poll is cut short.
    std::optional<utils::http::result> post_signed(const std::string& url, const std::string& body,
                                                   int timeout = 30,
                                                   std::function<bool(size_t, size_t, size_t)> abort = {});

    // POSTs a signed body, returning the parsed 200 response or nullopt.
    std::optional<rapidjson::Document> post_json(const std::string& url, const std::string& body,
                                                 int timeout = 30,
                                                 std::function<bool(size_t, size_t, size_t)> abort = {});
}
