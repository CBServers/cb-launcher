#include "authenticode.hpp"

#include <Windows.h>
#include <wincrypt.h>
#include <wintrust.h>
#include <SoftPub.h>

#include <cwctype>
#include <string>
#include <string_view>
#include <vector>

#pragma comment(lib, "wintrust.lib")
#pragma comment(lib, "crypt32.lib")

namespace utils::authenticode
{
    namespace
    {
        bool has_valid_signature(const std::wstring& file)
        {
            WINTRUST_FILE_INFO file_info{};
            file_info.cbStruct = sizeof(file_info);
            file_info.pcwszFilePath = file.data();

            GUID action = WINTRUST_ACTION_GENERIC_VERIFY_V2;

            WINTRUST_DATA data{};
            data.cbStruct = sizeof(data);
            data.dwUIChoice = WTD_UI_NONE;
            data.fdwRevocationChecks = WTD_REVOKE_NONE;
            data.dwUnionChoice = WTD_CHOICE_FILE;
            data.pFile = &file_info;
            data.dwStateAction = WTD_STATEACTION_VERIFY;
            data.dwProvFlags = WTD_CACHE_ONLY_URL_RETRIEVAL;

            const auto status = WinVerifyTrust(nullptr, &action, &data);

            data.dwStateAction = WTD_STATEACTION_CLOSE;
            WinVerifyTrust(nullptr, &action, &data);

            return status == ERROR_SUCCESS;
        }

        bool signer_name_starts_with_microsoft(const std::wstring& file)
        {
            HCERTSTORE store = nullptr;
            HCRYPTMSG msg = nullptr;

            if (!CryptQueryObject(CERT_QUERY_OBJECT_FILE, file.data(),
                CERT_QUERY_CONTENT_FLAG_PKCS7_SIGNED_EMBED, CERT_QUERY_FORMAT_FLAG_BINARY,
                0, nullptr, nullptr, nullptr, &store, &msg, nullptr))
            {
                return false;
            }

            auto result = false;

            DWORD info_size = 0;
            if (CryptMsgGetParam(msg, CMSG_SIGNER_INFO_PARAM, 0, nullptr, &info_size) && info_size > 0)
            {
                std::vector<uint8_t> buffer(info_size);
                if (CryptMsgGetParam(msg, CMSG_SIGNER_INFO_PARAM, 0, buffer.data(), &info_size))
                {
                    const auto* signer = reinterpret_cast<CMSG_SIGNER_INFO*>(buffer.data());

                    CERT_INFO cert_info{};
                    cert_info.Issuer = signer->Issuer;
                    cert_info.SerialNumber = signer->SerialNumber;

                    if (const auto* cert = CertFindCertificateInStore(store,
                        X509_ASN_ENCODING | PKCS_7_ASN_ENCODING, 0, CERT_FIND_SUBJECT_CERT, &cert_info, nullptr))
                    {
                        wchar_t name[256]{};
                        if (CertGetNameStringW(cert, CERT_NAME_SIMPLE_DISPLAY_TYPE, 0, nullptr, name, ARRAYSIZE(name)) > 1)
                        {
                            constexpr std::wstring_view prefix = L"microsoft";
                            std::wstring lowered(name);
                            for (auto& c : lowered) c = static_cast<wchar_t>(std::towlower(c));
                            result = lowered.compare(0, prefix.size(), prefix) == 0;
                        }

                        CertFreeCertificateContext(cert);
                    }
                }
            }

            CryptMsgClose(msg);
            CertCloseStore(store, 0);
            return result;
        }
    }

    bool verify_microsoft_signature(const std::filesystem::path& file)
    {
        const auto path = file.wstring();
        return has_valid_signature(path) && signer_name_starts_with_microsoft(path);
    }
}
