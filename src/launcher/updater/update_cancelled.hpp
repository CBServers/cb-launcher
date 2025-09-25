#pragma once

#include <stdexcept>

namespace updater
{
	class update_cancelled : public std::runtime_error
	{
	public:
		update_cancelled();
	};
}
