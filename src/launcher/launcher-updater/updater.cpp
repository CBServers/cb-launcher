#include <std_include.hpp>

#include "updater.hpp"
#include "updater_ui.hpp"
#include "file_updater.hpp"

#include <version.hpp>

#include <utils/properties.hpp>

namespace updater
{
	void run(const std::filesystem::path& base)
	{
		const utils::nt::library self;
		const auto self_file = self.get_path();

		updater_ui updater_ui{};
		const file_updater file_updater{updater_ui, base, self_file};

		file_updater.run();

		std::this_thread::sleep_for(1s);
	}
}
