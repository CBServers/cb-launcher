#include <std_include.hpp>
#include "update_cancelled.hpp"

namespace launcher_updater
{
	update_cancelled::update_cancelled()
		: std::runtime_error("Update was cancelled")
	{
	}
}
