#include "exit_callback.hpp"
#include "concurrency.hpp"

#include <stack>

namespace utils
{
	namespace
	{
		using callback_stack = std::stack<std::function<void()>>;
		concurrency::container<callback_stack>* get_callbacks();

		void execute_callbacks()
		{
			auto* callbacks = get_callbacks();
			if (!callbacks)
			{
				return;
			}

			callbacks->access([](callback_stack& callback_stack)
			{
				while (!callback_stack.empty())
				{
					callback_stack.top()();
					callback_stack.pop();
				}
			});

			delete callbacks;
		}

		concurrency::container<callback_stack>* get_callbacks()
		{
			static auto* callbacks = []()
			{
				::atexit(&execute_callbacks);
				return new concurrency::container<callback_stack>();
			}();

			return callbacks;
		}
	}

	void at_exit(std::function<void()> callback)
	{
		auto* callbacks = get_callbacks();
		callbacks->access([&callback](callback_stack& callback_stack)
		{
			callback_stack.push(std::move(callback));
		});
	}
}
