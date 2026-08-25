miniz = {
	source = path.join(dependencies.basePath, "miniz"),
	generated = path.join("build", "miniz"),
}

-- miniz_export.h is normally produced by CMake's generate_export_header.
function miniz.writeExportHeader()
	os.mkdir(miniz.generated)
	io.writefile(path.join(miniz.generated, "miniz_export.h"),
		"#pragma once\n#define MINIZ_EXPORT\n#define MINIZ_NO_EXPORT\n")
end

function miniz.import()
	links { "miniz" }
	miniz.includes()
end

function miniz.includes()
	includedirs {
		miniz.source,
		miniz.generated,
	}

	defines {
		"MINIZ_NO_ARCHIVE_WRITING_APIS",
		"MINIZ_NO_TIME",
	}
end

function miniz.project()
	miniz.writeExportHeader()

	project "miniz"
		language "C"

		miniz.includes()

		files {
			path.join(miniz.source, "*.h"),
			path.join(miniz.source, "miniz.c"),
			path.join(miniz.source, "miniz_tinfl.c"),
			path.join(miniz.source, "miniz_tdef.c"),
			path.join(miniz.source, "miniz_zip.c"),
		}

		defines {
			"_CRT_SECURE_NO_WARNINGS",
		}

		warnings "Off"
		kind "StaticLib"
end

table.insert(dependencies, miniz)
