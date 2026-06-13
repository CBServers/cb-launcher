discord_social_sdk = {
	versionShort = "1.9.16441",
	source = path.join(dependencies.basePath, "discord_social_sdk"),
}

function discord_social_sdk.import()
	filter {"kind:not StaticLib" }
	links { "discord_partner_sdk" }
	libdirs { path.join(discord_social_sdk.source, "lib/release") }
	linkoptions { "/DELAYLOAD:discord_partner_sdk.dll" }
	postbuildcommands {
		"mkdir \"%{wks.location}runtime/%{cfg.platform}/%{cfg.buildcfg}/discord/\" 2> nul",
		"copy /y \"%{wks.location}..\\deps\\discord_social_sdk\\bin\\release\\discord_partner_sdk.dll\" \"%{wks.location}runtime\\%{cfg.platform}\\%{cfg.buildcfg}\\discord\\\"",
	}
	filter {}
	discord_social_sdk.includes()
end

function discord_social_sdk.includes()
	includedirs {
		path.join(discord_social_sdk.source, "include"),
	}
end

function discord_social_sdk.install()
	if os.host() == "windows" then
		local result = os.executef("powershell -c \"Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process; %s %s\"", ".\\scripts\\get-discord-sdk.ps1", discord_social_sdk.versionShort)
		return result == true
	else
		premake.error(string.format("Your OS does not support automatic Discord Social SDK installation.\n"
			.. "Please download the SDK version '%s' yourself and place it in 'deps/discord_social_sdk'.\n"
			.. "Afterwards create a file 'deps/discord_social_sdk/.launcher_version.txt' with content '%s'.",
			discord_social_sdk.versionShort, discord_social_sdk.versionShort
		))
	end
	return true
end

function discord_social_sdk.checkVersion()
	local versionFile = path.join(discord_social_sdk.source, ".launcher_version.txt")
	local installedVersion = io.readfile(versionFile)

	if installedVersion ~= discord_social_sdk.versionShort then
		print("Discord Social SDK dependency outdated. Attempting to install new version.")
		if discord_social_sdk.install() then
			io.writefile(versionFile, discord_social_sdk.versionShort)
		else
			premake.error("Failed to install Discord Social SDK.")
		end
	end
end

function discord_social_sdk.project()
	discord_social_sdk.checkVersion()
end

table.insert(dependencies, discord_social_sdk)
