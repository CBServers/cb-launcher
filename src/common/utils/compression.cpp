#include "compression.hpp"
#include "string.hpp"

#include <ShlObj.h>
#include <atlbase.h>

// CoInitialize is called already in com.cpp
namespace utils::compression
{
	void decompress(const std::filesystem::path& file, const std::filesystem::path& into)
	{
		HRESULT hr{};

		CComPtr<IShellDispatch> shell_dispatch{};
		if (FAILED(shell_dispatch.CoCreateInstance(CLSID_Shell)))
		{
			throw std::runtime_error("Failed to create co instance");
		}

		CComVariant variant_dir{}, variant_file{}, variant_opt{};

		variant_dir.vt = VT_BSTR;
		variant_dir.bstrVal = SysAllocString(into.wstring().data());

		// Destination is our zip file
		CComPtr<Folder> path_to_folder{};
		hr = shell_dispatch->NameSpace(variant_dir, &path_to_folder);
		if (FAILED(hr))
		{
			throw std::runtime_error("Failed to name space");
		}

		variant_file.vt = VT_BSTR;
		variant_file.bstrVal = SysAllocString(file.wstring().data());

		CComPtr<Folder> path_of_origin{};
		hr = shell_dispatch->NameSpace(variant_file, &path_of_origin);
		if (FAILED(hr))
		{
			throw std::runtime_error("Failed to name space");
		}

		CComPtr<FolderItems> folder_items{};
		hr = path_of_origin->Items(&folder_items);
		if (FAILED(hr))
		{
			throw std::runtime_error("Failed to set folder items");
		}

		variant_opt.vt = VT_I4;
#if _DEBUG
		variant_opt.lVal = FOF_NOCONFIRMMKDIR | FOF_NOCONFIRMATION | FOF_SIMPLEPROGRESS;
#else
		variant_opt.lVal = FOF_NO_UI; // Windows vista and later only
#endif

		// Creating a new Variant with pointer to FolderItems to be copied
		CComVariant variant_to{};
		variant_to.vt = VT_DISPATCH;
		variant_to.pdispVal = folder_items;

		hr = path_to_folder->CopyHere(variant_to, variant_opt);
		if (FAILED(hr))
		{
			throw std::runtime_error("Failed to copy files");
		}
	}
}
