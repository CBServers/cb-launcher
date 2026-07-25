wintoast = {
	source = path.join(dependencies.basePath, "WinToast"),
}

function wintoast.import()
	links { "WinToast" }
	wintoast.includes()
end

function wintoast.includes()
	includedirs {
		path.join(wintoast.source, "include"),
	}
end

function wintoast.project()
	project "WinToast"
		language "C++"

		wintoast.includes()

		files {
			path.join(wintoast.source, "include/wintoastlib.h"),
			path.join(wintoast.source, "src/wintoastlib.cpp"),
		}

		warnings "Off"
		kind "StaticLib"
end

table.insert(dependencies, wintoast)
