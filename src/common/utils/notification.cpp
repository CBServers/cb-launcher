#include "notification.hpp"
#include "nt.hpp"
#include "string.hpp"

#pragma warning(push)
#pragma warning(disable: 6387)
#include <wintoastlib.h>
#pragma warning(pop)

namespace utils::notification
{
    namespace
    {
        // Toasts outlive the invite they announce; drop them from the Action Center after this.
        constexpr int64_t EXPIRATION_MS = 5 * 60 * 1000;

        bool initialize()
        {
            static const bool success = []
            {
                // Wine has no notification platform, and initialize() would only fail slowly.
                if (nt::is_wine_environment() || !WinToastLib::WinToast::isCompatible())
                {
                    return false;
                }

                auto* const instance = WinToastLib::WinToast::instance();
                if (!instance)
                {
                    return false;
                }

                instance->setAppName(APP_NAME);
                instance->setAppUserModelId(APP_USER_MODEL_ID);

                // The launcher stamps the AUMID onto its own Start Menu shortcut, so WinToast
                // must not create a second one of its own next to it.
                instance->setShortcutPolicy(WinToastLib::WinToast::SHORTCUT_POLICY_IGNORE);

                return instance->initialize();
            }();

            return success;
        }

        class toast_handler final : public WinToastLib::IWinToastHandler
        {
        public:
            explicit toast_handler(std::function<void()> on_activated)
                : on_activated_(std::move(on_activated))
            {
            }

            void toastActivated() const override
            {
                if (this->on_activated_) this->on_activated_();
            }

            void toastActivated(int) const override
            {
                if (this->on_activated_) this->on_activated_();
            }

            void toastActivated(std::wstring) const override
            {
            }

            void toastFailed() const override
            {
            }

            void toastDismissed(WinToastDismissalReason) const override
            {
            }

        private:
            std::function<void()> on_activated_;
        };

        bool usable_image(const std::filesystem::path& path)
        {
            if (path.empty()) return false;

            std::error_code ec;
            return std::filesystem::is_regular_file(path, ec);
        }
    }

    bool available()
    {
        return initialize();
    }

    int64_t show(const options& options)
    {
        if (!initialize())
        {
            return invalid_id;
        }

        WinToastLib::WinToastTemplate toast{WinToastLib::WinToastTemplate::ImageAndText02};
        toast.setTextField(string::convert(options.title), WinToastLib::WinToastTemplate::FirstLine);
        toast.setTextField(string::convert(options.body), WinToastLib::WinToastTemplate::SecondLine);
        toast.setDuration(WinToastLib::WinToastTemplate::Long);
        toast.setExpiration(EXPIRATION_MS);
        toast.setAudioPath(WinToastLib::WinToastTemplate::IM);

        if (usable_image(options.logo))
        {
            toast.setImagePath(options.logo.wstring(), WinToastLib::WinToastTemplate::Circle);
        }

        if (usable_image(options.hero))
        {
            toast.setHeroImagePath(options.hero.wstring());
        }

        const auto id = WinToastLib::WinToast::instance()->showToast(
            toast, new toast_handler(options.on_activated));

        return id < 0 ? invalid_id : id;
    }

    void dismiss(const int64_t id)
    {
        if (id == invalid_id || !initialize())
        {
            return;
        }

        WinToastLib::WinToast::instance()->hideToast(id);
    }
}
