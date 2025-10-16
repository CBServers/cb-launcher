#pragma once

#include <stdexcept>

namespace launcher_updater
{
	class update_cancelled : public std::runtime_error
	{
	public:
		update_cancelled();
	};
}
