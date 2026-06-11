discord_social_sdk = {
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

function discord_social_sdk.project()
	if not os.isfile(path.join(discord_social_sdk.source, "include/discordpp.h")) then
		premake.error("Discord Social SDK is missing from 'deps/discord_social_sdk'.\n"
			.. "For licensing reasons it cannot be committed to this repository.\n"
			.. "Download it from the Discord developer portal (your application -> Social SDK -> Downloads)\n"
			.. "and extract 'include', 'lib/release' and 'bin/release' into 'deps/discord_social_sdk'."
		)
	end
end

table.insert(dependencies, discord_social_sdk)
