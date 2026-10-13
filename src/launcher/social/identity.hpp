#pragma once

#include <mutex>
#include <optional>
#include <string>

namespace social
{
    // A copy of DPAPI-protected values in HKCU, so deleting the data folder does not lose them. Off in portable mode.
    namespace backup
    {
        std::optional<std::string> load(const wchar_t* name);
        void store(const wchar_t* name, const std::string& value);
        void clear(const wchar_t* name);
    }

    // Device ECC keypair that signs every CB backend request. Decoupled from the account, so it can rotate.
    class identity
    {
    public:
        static identity& instance();

        identity(const identity&) = delete;
        identity& operator=(const identity&) = delete;

        // Loads the stored key or mints and persists a fresh one. Idempotent.
        bool ensure();
        bool is_ready() const;
        // True when this session's key came back from the registry copy rather than the properties file.
        bool restored_from_backup() const;

        std::string public_key() const;  // ANSI X9.63 public bytes
        std::string fingerprint() const; // sha256 hex of the public key

        // base64(ecc_sign(sha256(payload))). Empty if not ready.
        std::string sign(const std::string& payload) const;
        bool verify(const std::string& payload, const std::string& signature_b64) const;

        // Wipes the key; the next ensure() mints a new one with a new fingerprint.
        void reset();

    private:
        identity() = default;

        // Takes a protected key as the session key if it decrypts and validates; caller holds mutex_.
        bool adopt_locked(const std::string& protected_key);

        mutable std::mutex mutex_;
        std::string private_key_;
        std::string public_key_;
        bool ready_{false};
        bool restored_{false};
    };
}
