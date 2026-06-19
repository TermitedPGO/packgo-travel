import { useLocale } from "@/contexts/LocaleContext";
import { Map } from "lucide-react";

export default function AdminTours() {
  const { t } = useLocale();
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <Map className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-gray-900 mb-1">{t("admin.navTours")}</h2>
        <p className="text-sm text-gray-400">{t("admin.placeholderMsg")}</p>
      </div>
    </div>
  );
}
