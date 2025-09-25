#include "nt.hpp"
#include <TlHelp32.h>
#include <delayimp.h>
#pragma comment(lib, "delayimp.lib")

#include <utils/string.hpp>

#include "finally.hpp"

namespace utils::nt
{
	library library::load(const std::string& name)
	{
		return library(LoadLibraryA(name.data()));
	}

	library library::load(const std::filesystem::path& path)
	{
		return load(path.generic_string());
	}

	library library::get_by_address(void* address)
	{
		HMODULE handle = nullptr;
		GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
		                   static_cast<LPCSTR>(address), &handle);
		return library(handle);
	}

	library::library()
	{
		this->module_ = GetModuleHandleA(nullptr);
	}

	library::library(const std::string& name)
	{
		this->module_ = GetModuleHandleA(name.data());
	}

	library::library(const HMODULE handle)
	{
		this->module_ = handle;
	}

	bool library::operator==(const library& obj) const
	{
		return this->module_ == obj.module_;
	}

	library::operator bool() const
	{
		return this->is_valid();
	}

	library::operator HMODULE() const
	{
		return this->get_handle();
	}

	PIMAGE_NT_HEADERS library::get_nt_headers() const
	{
		if (!this->is_valid()) return nullptr;
		return reinterpret_cast<PIMAGE_NT_HEADERS>(this->get_ptr() + this->get_dos_header()->e_lfanew);
	}

	PIMAGE_DOS_HEADER library::get_dos_header() const
	{
		return reinterpret_cast<PIMAGE_DOS_HEADER>(this->get_ptr());
	}

	PIMAGE_OPTIONAL_HEADER library::get_optional_header() const
	{
		if (!this->is_valid()) return nullptr;
		return &this->get_nt_headers()->OptionalHeader;
	}

	std::vector<PIMAGE_SECTION_HEADER> library::get_section_headers() const
	{
		std::vector<PIMAGE_SECTION_HEADER> headers;

		auto nt_headers = this->get_nt_headers();
		auto section = IMAGE_FIRST_SECTION(nt_headers);

		for (uint16_t i = 0; i < nt_headers->FileHeader.NumberOfSections; ++i, ++section)
		{
			if (section) headers.push_back(section);
			else OutputDebugStringA("There was an invalid section :O");
		}

		return headers;
	}

	std::uint8_t* library::get_ptr() const
	{
		return reinterpret_cast<std::uint8_t*>(this->module_);
	}

	void library::unprotect() const
	{
		if (!this->is_valid()) return;

		DWORD protection;
		VirtualProtect(this->get_ptr(), this->get_optional_header()->SizeOfImage, PAGE_EXECUTE_READWRITE,
		               &protection);
	}

	size_t library::get_relative_entry_point() const
	{
		if (!this->is_valid()) return 0;
		return this->get_nt_headers()->OptionalHeader.AddressOfEntryPoint;
	}

	void* library::get_entry_point() const
	{
		if (!this->is_valid()) return nullptr;
		return this->get_ptr() + this->get_relative_entry_point();
	}

	bool library::is_valid() const
	{
		return this->module_ != nullptr && this->get_dos_header()->e_magic == IMAGE_DOS_SIGNATURE;
	}

	std::string library::get_name() const
	{
		if (!this->is_valid()) return {};

		const auto path = this->get_path();
		const auto pos = path.generic_string().find_last_of("/\\");
		if (pos == std::string::npos) return path.generic_string();

		return path.generic_string().substr(pos + 1);
	}

	std::filesystem::path library::get_path() const
	{
		if (!this->is_valid()) return {};

		wchar_t name[MAX_PATH]{};
		GetModuleFileNameW(this->module_, name, MAX_PATH);

		return std::filesystem::path{ name };
	}

	std::filesystem::path library::get_folder() const
	{
		if (!this->is_valid()) return {};

		const auto path = this->get_path();
		return path.parent_path();
	}

	void library::free()
	{
		if (this->is_valid())
		{
			FreeLibrary(this->module_);
			this->module_ = nullptr;
		}
	}

	HMODULE library::get_handle() const
	{
		return this->module_;
	}

	void** library::get_iat_entry(const std::string& module_name, const std::string& proc_name) const
	{
		if (!this->is_valid()) return nullptr;

		const library other_module(module_name);
		if (!other_module.is_valid()) return nullptr;

		auto* const target_function = other_module.get_proc<void*>(proc_name);
		if (!target_function) return nullptr;

		auto* header = this->get_optional_header();
		if (!header) return nullptr;

		auto* import_descriptor = reinterpret_cast<PIMAGE_IMPORT_DESCRIPTOR>(this->get_ptr() + header->DataDirectory
			[IMAGE_DIRECTORY_ENTRY_IMPORT].VirtualAddress);

		while (import_descriptor->Name)
		{
			if (!_stricmp(reinterpret_cast<char*>(this->get_ptr() + import_descriptor->Name), module_name.data()))
			{
				auto* original_thunk_data = reinterpret_cast<PIMAGE_THUNK_DATA>(import_descriptor->
					OriginalFirstThunk + this->get_ptr());
				auto* thunk_data = reinterpret_cast<PIMAGE_THUNK_DATA>(import_descriptor->FirstThunk + this->
					get_ptr());

				while (original_thunk_data->u1.AddressOfData)
				{
					const size_t ordinal_number = original_thunk_data->u1.AddressOfData & 0xFFFFFFF;

					if (ordinal_number > 0xFFFF) continue;

					if (GetProcAddress(other_module.module_, reinterpret_cast<char*>(ordinal_number)) ==
						FARPROC(target_function))
					{
						return reinterpret_cast<void**>(&thunk_data->u1.Function);
					}

					++original_thunk_data;
					++thunk_data;
				}

				//break;
			}

			++import_descriptor;
		}

		return nullptr;
	}

	void library::set_dll_directory(const std::filesystem::path& directory)
	{
		SetDllDirectoryW(directory.wstring().data());
	}

	std::filesystem::path library::get_dll_directory()
	{
		wchar_t directory[MAX_PATH] = {0};
		if (!GetDllDirectoryW(MAX_PATH, directory))
		{
			return {};
		}

		return {directory};
	}

	bool library::delay_load(const std::string& library)
	{
		__try
		{
			return SUCCEEDED(__HrLoadAllImportsForDll(library.data()));
		}
		__except (EXCEPTION_EXECUTE_HANDLER)
		{
			return false;
		}
	}

	void raise_hard_exception()
	{
		int data = false;
		const library ntdll("ntdll.dll");
		ntdll.invoke_pascal<void>("RtlAdjustPrivilege", 19, true, false, &data);
		ntdll.invoke_pascal<void>("NtRaiseHardError", 0xC000007B, 0, nullptr, nullptr, 6, &data);
	}

	std::string load_resource(const int id)
	{
		auto* const res = FindResource(library(), MAKEINTRESOURCE(id), RT_RCDATA);
		if (!res) return {};

		auto* const handle = LoadResource(nullptr, res);
		if (!handle) return {};

		return std::string(LPSTR(LockResource(handle)), SizeofResource(nullptr, res));
	}

	void launch_process(const std::filesystem::path& process, const std::string& command_line)
	{
		STARTUPINFOW startup_info;
		PROCESS_INFORMATION process_info;

		ZeroMemory(&startup_info, sizeof(startup_info));
		ZeroMemory(&process_info, sizeof(process_info));
		startup_info.cb = sizeof(startup_info);

		wchar_t current_dir[MAX_PATH];
		GetCurrentDirectoryW(MAX_PATH, current_dir);

		CreateProcessW(process.wstring().data(), string::convert(command_line).data(), nullptr, nullptr, false, NULL, nullptr, current_dir,
		               &startup_info, &process_info);

		if (process_info.hThread && process_info.hThread != INVALID_HANDLE_VALUE) CloseHandle(process_info.hThread);
		if (process_info.hProcess && process_info.hProcess != INVALID_HANDLE_VALUE) CloseHandle(process_info.hProcess);
	}

	void relaunch_self(std::string command_line)
	{
		const utils::nt::library self;
		launch_process(self.get_path(), command_line);
	}

	void update_dll_search_path(const std::filesystem::path& directory)
	{
		const library self;
		self.set_dll_directory(directory);
	}

	unsigned long get_parent_pid()
	{
		const HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
		if (snapshot == INVALID_HANDLE_VALUE) return 0;

		const auto _ = utils::finally([&]()
		{
			CloseHandle(snapshot);
		});

		PROCESSENTRY32 pe32;
		ZeroMemory(&pe32, sizeof(pe32));
		pe32.dwSize = sizeof(pe32);

		if (!Process32First(snapshot, &pe32))
		{
			return 0;
		}

		const auto pid = GetCurrentProcessId();
		do
		{
			if (pe32.th32ProcessID == pid)
			{
				return pe32.th32ParentProcessID;
			}
		} while (Process32Next(snapshot, &pe32));

		return 0;
	}

	bool wait_for_process(const unsigned long pid)
	{
		auto* const process_handle = OpenProcess(SYNCHRONIZE, FALSE, pid);
		if (!process_handle)
		{
			return false;
		}

		const auto _ = utils::finally([&]()
		{
			CloseHandle(process_handle);
		});

		WaitForSingleObject(process_handle, INFINITE);
		return true;
	}

	__declspec(noreturn) void terminate(const uint32_t code)
	{
		TerminateProcess(GetCurrentProcess(), code);
	}
}
