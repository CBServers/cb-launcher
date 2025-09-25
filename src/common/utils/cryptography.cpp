#include "string.hpp"
#include "cryptography.hpp"
#include "nt.hpp"

#include "finally.hpp"

#include <bcrypt.h>
#pragma comment(lib, "Bcrypt.lib")

namespace utils::cryptography
{
	namespace
	{
		std::string compute_hash(const LPCWSTR hash_name, const uint8_t* data, const size_t length, const bool hex)
		{
			BCRYPT_ALG_HANDLE algorithm{};
			if (FAILED(BCryptOpenAlgorithmProvider(&algorithm, hash_name, nullptr, 0)))
			{
				return {};
			}

			auto _ = utils::finally([&algorithm]()
			{
				BCryptCloseAlgorithmProvider(algorithm, 0);
			});

			DWORD hash_obj_length{}, data_count{}, hash_data_length{};
			if (FAILED(BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH,
				reinterpret_cast<PBYTE>(&hash_obj_length),
				sizeof(DWORD),
				&data_count,
				0)))
			{
				return {};
			}


			if (FAILED(BCryptGetProperty(algorithm, BCRYPT_HASH_LENGTH,
				reinterpret_cast<PBYTE>(&hash_data_length),
				sizeof(DWORD),
				&data_count,
				0)))
			{
				return {};
			}

			std::string hash_obj_data{}, hash_data{};
			hash_obj_data.resize(hash_obj_length);
			hash_data.resize(hash_data_length);

			BCRYPT_HASH_HANDLE hash_handle{};

			if (FAILED(BCryptCreateHash(
				algorithm,
				&hash_handle,
				reinterpret_cast<PBYTE>(hash_obj_data.data()),
				static_cast<ULONG>(hash_obj_data.size()),
				NULL,
				0,
				0)))
			{
				return {};
			}

			if (FAILED(BCryptHashData(hash_handle, const_cast<PBYTE>(data),
				static_cast<ULONG>(length), 0)))
			{
				return {};
			}

			if (FAILED(BCryptFinishHash(
				hash_handle,
				reinterpret_cast<PBYTE>(hash_data.data()),
				static_cast<ULONG>(hash_data.size()),
				0)))
			{
				return {};
			}

			if (!hex) return hash_data;

			return string::dump_hex(hash_data, "");
		}
	}

	std::string sha1::compute(const std::string& data, const bool hex)
	{
		return compute(reinterpret_cast<const uint8_t*>(data.data()), data.size(), hex);
	}

	std::string sha1::compute(const uint8_t* data, const size_t length, const bool hex)
	{
		return compute_hash(BCRYPT_SHA1_ALGORITHM, data, length, hex);
	}
}
