#include "std_include.hpp"
#include "identity.hpp"

#include <utils/cryptography.hpp>
#include <utils/logger.hpp>
#include <utils/properties.hpp>
#include <utils/property_keys.hpp>
#include <utils/registry.hpp>
#include <utils/string.hpp>

namespace social
{
    namespace backup
    {
        namespace
        {
#ifdef DEBUG
            constexpr const wchar_t* SUBKEY = L"Software\\cbservers_debug";
#else
            constexpr const wchar_t* SUBKEY = L"Software\\cbservers";
#endif
        }

        std::optional<std::string> load(const wchar_t* name)
        {
            if (utils::properties::is_portable())
            {
                return std::nullopt;
            }

            const auto value = utils::registry::get_hkcu_string(SUBKEY, name);
            if (!value || value->empty())
            {
                return std::nullopt;
            }

            return utils::string::convert(*value);
        }

        void store(const wchar_t* name, const std::string& value)
        {
            if (!utils::properties::is_portable())
            {
                utils::registry::set_hkcu_string(SUBKEY, name, utils::string::convert(value));
            }
        }

        void clear(const wchar_t* name)
        {
            if (!utils::properties::is_portable())
            {
                utils::registry::delete_hkcu_value(SUBKEY, name);
            }
        }
    }

    namespace
    {
        constexpr const wchar_t* BACKUP_KEY = L"device-key";

        // Same at-rest scheme as discord::token_store: DPAPI then base64.
        std::string protect(const std::string& value)
        {
            const auto blob = utils::cryptography::dpapi::protect(value);
            if (!blob)
            {
                return {};
            }

            return utils::cryptography::base64::encode(*blob);
        }

        std::optional<std::string> unprotect(const std::string& value)
        {
            const auto blob = utils::cryptography::base64::decode(value);
            if (blob.empty())
            {
                return std::nullopt;
            }

            return utils::cryptography::dpapi::unprotect(blob);
        }

        std::optional<std::string> load_stored()
        {
            const auto guard = utils::properties::lock();
            return utils::properties::load(property_keys::CB_DEVICE_PRIVATE_KEY);
        }

        void store_stored(const std::string& value)
        {
            const auto guard = utils::properties::lock();
            utils::properties::store(property_keys::CB_DEVICE_PRIVATE_KEY, value);
        }
    }

    identity& identity::instance()
    {
        static identity instance;
        return instance;
    }

    bool identity::adopt_locked(const std::string& protected_key)
    {
        const auto priv = unprotect(protected_key);
        if (!priv || priv->empty())
        {
            return false;
        }

        utils::cryptography::ecc::key key;
        key.deserialize(*priv);
        if (!key.is_valid())
        {
            return false;
        }

        auto pub = key.get_public_key();
        if (pub.empty())
        {
            return false;
        }

        private_key_ = *priv;
        public_key_ = std::move(pub);
        ready_ = true;
        return true;
    }

    bool identity::ensure()
    {
        std::lock_guard lock(mutex_);
        if (ready_)
        {
            return true;
        }

        const auto stored = load_stored();
        const auto saved = backup::load(BACKUP_KEY);
        if (stored && !stored->empty() && adopt_locked(*stored))
        {
            if (saved != stored) backup::store(BACKUP_KEY, *stored); // first run since the backup existed
            return true;
        }

        // The properties file was wiped or unreadable; the registry copy survives a deleted data folder.
        if (saved && saved != stored && adopt_locked(*saved))
        {
            store_stored(*saved);
            restored_ = true;
            utils::logger::write("CB device key restored from the registry backup");
            return true;
        }

        auto key = utils::cryptography::ecc::generate_key(256);
        if (!key.is_valid())
        {
            return false;
        }

        auto priv = key.serialize(PK_PRIVATE);
        auto pub = key.get_public_key();
        if (priv.empty() || pub.empty())
        {
            return false;
        }

        const auto protected_priv = protect(priv);
        if (protected_priv.empty())
        {
            return false;
        }

        store_stored(protected_priv);
        backup::store(BACKUP_KEY, protected_priv);

        private_key_ = std::move(priv);
        public_key_ = std::move(pub);
        ready_ = true;
        return true;
    }

    bool identity::is_ready() const
    {
        std::lock_guard lock(mutex_);
        return ready_;
    }

    bool identity::restored_from_backup() const
    {
        std::lock_guard lock(mutex_);
        return restored_;
    }

    std::string identity::public_key() const
    {
        std::lock_guard lock(mutex_);
        return public_key_;
    }

    std::string identity::fingerprint() const
    {
        std::lock_guard lock(mutex_);
        if (!ready_)
        {
            return {};
        }

        return utils::cryptography::sha256::compute(public_key_, true);
    }

    std::string identity::sign(const std::string& payload) const
    {
        std::lock_guard lock(mutex_);
        if (!ready_)
        {
            return {};
        }

        utils::cryptography::ecc::key key;
        key.deserialize(private_key_);
        if (!key.is_valid())
        {
            return {};
        }

        // ecc_sign_hash treats its input as a digest, so hash the payload first.
        const auto digest = utils::cryptography::sha256::compute(payload, false);
        const auto signature = utils::cryptography::ecc::sign_message(key, digest);
        if (signature.empty())
        {
            return {};
        }

        return utils::cryptography::base64::encode(signature);
    }

    bool identity::verify(const std::string& payload, const std::string& signature_b64) const
    {
        std::lock_guard lock(mutex_);
        if (!ready_)
        {
            return false;
        }

        utils::cryptography::ecc::key key;
        key.set(public_key_);
        if (!key.is_valid())
        {
            return false;
        }

        const auto signature = utils::cryptography::base64::decode(signature_b64);
        if (signature.empty())
        {
            return false;
        }

        const auto digest = utils::cryptography::sha256::compute(payload, false);
        return utils::cryptography::ecc::verify_message(key, digest, signature);
    }

    void identity::reset()
    {
        std::lock_guard lock(mutex_);
        private_key_.clear();
        public_key_.clear();
        ready_ = false;
        restored_ = false;
        store_stored({}); // no delete in the store; empty reads back as missing
        backup::clear(BACKUP_KEY);
    }
}
