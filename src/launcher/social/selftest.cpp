#include "std_include.hpp"
#include "selftest.hpp"
#include "identity.hpp"
#include "hwid.hpp"

#include <utils/cryptography.hpp>
#include <utils/properties.hpp>
#include <utils/property_keys.hpp>

#include <cstdio>

namespace social
{
    namespace
    {
        // Reloads the key straight off disk, bypassing the singleton's cache, to prove it persisted.
        std::string fingerprint_from_disk()
        {
            std::optional<std::string> stored;
            {
                const auto guard = utils::properties::lock();
                stored = utils::properties::load(property_keys::CB_DEVICE_PRIVATE_KEY);
            }
            if (!stored || stored->empty())
            {
                return {};
            }

            const auto blob = utils::cryptography::base64::decode(*stored);
            if (blob.empty())
            {
                return {};
            }

            const auto priv = utils::cryptography::dpapi::unprotect(blob);
            if (!priv || priv->empty())
            {
                return {};
            }

            utils::cryptography::ecc::key key;
            key.deserialize(*priv);
            if (!key.is_valid())
            {
                return {};
            }

            return utils::cryptography::sha256::compute(key.get_public_key(), true);
        }

        void emit(std::string& report, const std::string& line)
        {
            report.append(line);
            report.push_back('\n');
            std::printf("%s\n", line.c_str());
        }

        std::string check(const bool ok, const std::string& name)
        {
            return std::string(ok ? "[PASS] " : "[FAIL] ") + name;
        }
    }

    int run_selftest()
    {
        // GUI-subsystem app: attach to the launching console, or open one.
        if (!AttachConsole(ATTACH_PARENT_PROCESS))
        {
            AllocConsole();
        }
        FILE* fp = nullptr;
        freopen_s(&fp, "CONOUT$", "w", stdout);
        freopen_s(&fp, "CONOUT$", "w", stderr);

        std::string report;
        emit(report, "=== CB social identity self-test (Phase 0) ===");

        auto& id = identity::instance();
        id.reset(); // start clean so the run always exercises a fresh mint

        const auto hwid1 = hwid::compute();
        const bool hwid_shape = hwid1.size() == 64;
        emit(report, "HWID: " + hwid1);

        const bool minted = id.ensure();
        const auto fp1 = id.fingerprint();
        emit(report, "Device fingerprint (mint 1): " + fp1);

        const auto disk_fp = fingerprint_from_disk();
        const bool persisted = !disk_fp.empty() && disk_fp == fp1;

        const std::string challenge = "cb-selftest-challenge";
        const auto signature = id.sign(challenge);
        const bool signed_ok = !signature.empty() && id.verify(challenge, signature);
        const bool tamper_rejected = !id.verify(challenge + "-TAMPERED", signature);

        const auto hwid2 = hwid::compute();
        const bool hwid_stable = hwid_shape && hwid2 == hwid1;

        // Recovery: wiping local data must yield a new key but the same HWID anchor.
        id.reset();
        const bool reminted = id.ensure();
        const auto fp2 = id.fingerprint();
        const auto hwid3 = hwid::compute();
        const bool recovery_ok = reminted && !fp2.empty() && fp2 != fp1 && hwid3 == hwid1;
        emit(report, "Device fingerprint (mint 2): " + fp2);

        emit(report, "");
        emit(report, check(minted, "mint device keypair"));
        emit(report, check(persisted, "private key persists (DPAPI+base64, reloaded from disk)"));
        emit(report, check(signed_ok, "sign + verify round-trip"));
        emit(report, check(tamper_rejected, "tampered payload rejected"));
        emit(report, check(hwid_stable, "HWID hash stable across calls"));
        emit(report, check(recovery_ok, "recovery: new key, same HWID anchor"));

        const bool all = minted && persisted && signed_ok && tamper_rejected && hwid_stable && recovery_ok;
        emit(report, "");
        emit(report, all ? "RESULT: ALL PASSED" : "RESULT: FAILURES PRESENT");

        try
        {
            const auto log_path = utils::properties::get_appdata_path() / "cb-social-selftest.log";
            std::ofstream(log_path, std::ios::binary | std::ios::trunc).write(report.data(),
                static_cast<std::streamsize>(report.size()));
        }
        catch (...)
        {
        }

        return all ? 0 : 1;
    }

    int run_dump()
    {
        if (!AttachConsole(ATTACH_PARENT_PROCESS))
        {
            AllocConsole();
        }
        FILE* fp = nullptr;
        freopen_s(&fp, "CONOUT$", "w", stdout);

        auto& id = identity::instance();
        if (!id.ensure())
        {
            std::printf("dump: failed to establish identity\n");
            return 1;
        }

        const std::string challenge = "cb-boundary-challenge";
        const auto public_key_b64 = utils::cryptography::base64::encode(id.public_key());
        const auto signature_b64 = id.sign(challenge);
        const auto fingerprint = id.fingerprint();

        // Hand-built JSON: every value is base64 or ASCII, so no escaping is needed.
        std::string json;
        json += "{\n";
        json += "  \"fingerprint\": \"" + fingerprint + "\",\n";
        json += "  \"publicKeyB64\": \"" + public_key_b64 + "\",\n";
        json += "  \"challenge\": \"" + challenge + "\",\n";
        json += "  \"signatureB64\": \"" + signature_b64 + "\"\n";
        json += "}\n";

        std::printf("%s", json.c_str());

        try
        {
            const auto out_path = utils::properties::get_appdata_path() / "cb-social-dump.json";
            std::ofstream(out_path, std::ios::binary | std::ios::trunc).write(json.data(),
                static_cast<std::streamsize>(json.size()));
        }
        catch (...)
        {
        }

        return 0;
    }
}
