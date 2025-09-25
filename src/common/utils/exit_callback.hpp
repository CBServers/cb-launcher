#pragma once
#include <functional>

namespace utils
{
	void at_exit(std::function<void()> callback);
}
