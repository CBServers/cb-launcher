xxhash = {
	source = path.join(dependencies.basePath, "xxhash"),
}

function xxhash.import()
	links { "xxhash" }
	xxhash.includes()
end

function xxhash.includes()
	includedirs {
		xxhash.source
	}

	defines {
		"XXH_STATIC_LINKING_ONLY",
	}
end

function xxhash.project()
	project "xxhash"
		language "C"

		xxhash.includes()

		files {
			path.join(xxhash.source, "xxhash.h"),
			path.join(xxhash.source, "xxhash.c"),
			path.join(xxhash.source, "xxh3.h"),
			path.join(xxhash.source, "xxh_x86dispatch.h"),
			path.join(xxhash.source, "xxh_x86dispatch.c"),
		}

		defines {
			"_CRT_SECURE_NO_DEPRECATE",
		}

		warnings "Off"
		kind "StaticLib"
end

table.insert(dependencies, xxhash)
