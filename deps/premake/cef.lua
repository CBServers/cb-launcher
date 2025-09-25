cef = {
	versionShort = "113.1.4",
	versionLong = "cef_binary_113.1.4+g327635f+chromium-113.0.5672.63_windows64",
	source = "deps/cef"
}

function cef.import()
	filter {"kind:not StaticLib" }
	links { "cef", "cef_sandbox", "libcef", "Dbghelp.lib", "Winmm.lib", "Version.lib", "SetupAPI.lib", "Powrprof.lib", "Propsys.lib" }
	linkoptions { "/DELAYLOAD:libcef.dll" }
	filter {}
	cef.includes()
end

function cef.includes()
	includedirs { cef.source }
	defines {
		"WRAPPING_CEF_SHARED",
		"NOMINMAX",
		"USING_CEF_SHARED",
	}
	
	filter { "Release" }
		libdirs { path.join(cef.source, "Release") }
	filter { "Debug" }
		libdirs { path.join(cef.source, "Debug") }
	filter {}
end

function cef.install()
	if os.host() == "windows" then
		local result = os.executef("powershell -c \"Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process; %s %s\"", ".\\scripts\\get-cef.ps1", cef.versionLong)
		return result == true
	else
		premake.error(string.format("Your OS does not support automatic CEF installation.\n"
			.. "Please download CEF version '%s' yourself and place it in 'deps/cef'.\n"
			.. "Afterwards create a file 'deps/cef/.launcher_version.txt' with content '%s'.",
			cef.versionShort, cef.versionShort
		))
	end
	return true
end

function cef.checkVersion()
	local versionFile = path.join(cef.source, ".launcher_version.txt")
	local installedVersion = io.readfile(versionFile)

	if installedVersion ~= cef.versionShort then
		print("CEF dependency outdated. Attempting to install new version.")
		if cef.install() then
			io.writefile(versionFile, cef.versionShort)
		else
			premake.error("Failed to install CEF.")
		end
	end
end

function cef.project()
	cef.checkVersion()

	project "cef"
		language "C++"

		cef.includes()
		files
		{
			path.join(cef.source, "libcef_dll/**.h"),
			path.join(cef.source, "libcef_dll/**.cc"),
		}

		postbuildcommands {
			"mkdir \"%{wks.location}runtime/%{cfg.platform}/%{cfg.buildcfg}/cef/\" 2> nul",
			"mkdir \"%{wks.location}runtime/%{cfg.platform}/%{cfg.buildcfg}/cef/locales/\" 2> nul",
			"copy /y \"%{wks.location}..\\deps\\cef\\%{cfg.buildcfg}\\*.dll\" \"%{wks.location}runtime\\%{cfg.platform}\\%{cfg.buildcfg}\\cef\\\"",
			"copy /y \"%{wks.location}..\\deps\\cef\\%{cfg.buildcfg}\\*.bin\" \"%{wks.location}runtime\\%{cfg.platform}\\%{cfg.buildcfg}\\cef\\\"",
			"copy /y \"%{wks.location}..\\deps\\cef\\Resources\\*.pak\" \"%{wks.location}runtime\\%{cfg.platform}\\%{cfg.buildcfg}\\cef\\\"",
			"copy /y \"%{wks.location}..\\deps\\cef\\Resources\\*.dat\" \"%{wks.location}runtime\\%{cfg.platform}\\%{cfg.buildcfg}\\cef\\\"",
			--"copy /y \"%{wks.location}..\\deps\\cef\\Resources\\locales\\*.pak\" \"%{wks.location}runtime\\%{cfg.platform}\\%{cfg.buildcfg}\\cef\\locales\\\"",
			"copy /y \"%{wks.location}..\\deps\\cef\\Resources\\locales\\en-US.pak\" \"%{wks.location}runtime\\%{cfg.platform}\\%{cfg.buildcfg}\\cef\\locales\\\"",
		}

		linkoptions { "-IGNORE:4221", "-IGNORE:4006" }
		removelinks "*"
		warnings "Off"
		kind "StaticLib"
end

table.insert(dependencies, cef)
