import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Calendar, MapPin, Search, Sparkles, Plane, Hotel, Ticket, Users, Lock, Pencil, X, Check, Upload, ImageIcon } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { DateRangePicker } from "@/components/DateRangePicker";
import { DateRange } from "react-day-picker";
import { DestinationAutocomplete } from "@/components/DestinationAutocomplete";
import { DepartureAutocomplete } from "@/components/DepartureAutocomplete";
import { toast } from "sonner";
import { useHomeEdit } from "@/contexts/HomeEditContext";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/contexts/LocaleContext";

interface HeroContent {
  title: string;
  subtitle: string;
  backgroundImage: string;
  hotKeywords: string[];
}

const defaultContent: HeroContent = {
  title: "精選旅程 折扣最後一週",
  subtitle: "* 跟著花期去旅行 *",
  backgroundImage: "/images/hero-sakura.webp",
  hotKeywords: ["北海道", "東京", "大阪", "歐洲", "土耳其", "郵輪", "滑雪"],
};

// 多語言熱門關鍵字映射（繁體中文和英文）
const hotKeywordsTranslations: Record<string, Record<string, string>> = {
  '北海道': { 'zh-TW': '北海道', 'en': 'Hokkaido' },
  '東京': { 'zh-TW': '東京', 'en': 'Tokyo' },
  '大阪': { 'zh-TW': '大阪', 'en': 'Osaka' },
  '歐洲': { 'zh-TW': '歐洲', 'en': 'Europe' },
  '土耳其': { 'zh-TW': '土耳其', 'en': 'Turkey' },
  '郵輪': { 'zh-TW': '郵輪', 'en': 'Cruise' },
  '滑雪': { 'zh-TW': '滑雪', 'en': 'Skiing' },
  '台灣': { 'zh-TW': '台灣', 'en': 'Taiwan' },
  '日本': { 'zh-TW': '日本', 'en': 'Japan' },
  '韓國': { 'zh-TW': '韓國', 'en': 'Korea' },
  '泰國': { 'zh-TW': '泰國', 'en': 'Thailand' },
  '新加坡': { 'zh-TW': '新加坡', 'en': 'Singapore' },
  '美國': { 'zh-TW': '美國', 'en': 'USA' },
  '加拿大': { 'zh-TW': '加拿大', 'en': 'Canada' },
  '澳洲': { 'zh-TW': '澳洲', 'en': 'Australia' },
  '紐西蘭': { 'zh-TW': '紐西蘭', 'en': 'New Zealand' },
  '義大利': { 'zh-TW': '義大利', 'en': 'Italy' },
  '法國': { 'zh-TW': '法國', 'en': 'France' },
  '西班牙': { 'zh-TW': '西班牙', 'en': 'Spain' },
  '英國': { 'zh-TW': '英國', 'en': 'UK' },
  '德國': { 'zh-TW': '德國', 'en': 'Germany' },
  '瑞士': { 'zh-TW': '瑞士', 'en': 'Switzerland' },
  '希臘': { 'zh-TW': '希臘', 'en': 'Greece' },
  '埃及': { 'zh-TW': '埃及', 'en': 'Egypt' },
  '以色列': { 'zh-TW': '以色列', 'en': 'Israel' },
  '越南': { 'zh-TW': '越南', 'en': 'Vietnam' },
  '峇里島': { 'zh-TW': '峇里島', 'en': 'Bali' },
  '馬爾地夫': { 'zh-TW': '馬爾地夫', 'en': 'Maldives' },
};

// 翻譯熱門關鍵字的輔助函數
const translateKeyword = (keyword: string, language: string): string => {
  const translations = hotKeywordsTranslations[keyword];
  if (translations && translations[language]) {
    return translations[language];
  }
  return keyword;
};

export default function EditableHero() {
  const [activeTab, setActiveTab] = useState("group");
  const [departure, setDeparture] = useState("");
  const [destination, setDestination] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [, setLocation] = useLocation();
  const { t, language } = useLocale();
  
  const { isEditMode, canEdit } = useHomeEdit();
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState<HeroContent>(defaultContent);
  const [showImageDialog, setShowImageDialog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Fetch hero content from database
  const { data: heroData, refetch } = trpc.homepage.getContent.useQuery(
    { sectionKey: 'hero' },
    { enabled: true }
  );

  const updateContentMutation = trpc.homepage.updateContent.useMutation({
    onSuccess: () => {
      toast.success(t('hero.edit.updateSuccess'));
      setIsEditing(false);
      refetch();
    },
    onError: (error) => {
      toast.error(t('hero.edit.updateError') + ': ' + error.message);
    },
  });

  // Use database content or default
  const content: HeroContent = heroData?.content || defaultContent;

  useEffect(() => {
    if (heroData?.content) {
      setEditContent(heroData.content as HeroContent);
    }
  }, [heroData]);

  const handleSearch = () => {
    const params = new URLSearchParams();
    if (destination.trim()) {
      params.set("destination", destination.trim());
    }
    if (departure.trim()) {
      params.set("departure", departure.trim());
    }
    const queryString = params.toString();
    setLocation(`/search${queryString ? `?${queryString}` : ""}`);
  };

  const handleKeywordClick = (keyword: string) => {
    setLocation(`/search?destination=${encodeURIComponent(keyword)}`);
  };

  const handleLockedTabClick = (tabName: string) => {
    toast.info(t('hero.search.featureComingSoon'));
  };

  const handleSaveContent = () => {
    updateContentMutation.mutate({
      sectionKey: 'hero',
      content: editContent,
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error(t('hero.edit.selectImageFile'));
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error(t('hero.edit.imageSizeLimit'));
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'hero');

      const response = await fetch('/api/upload/tour-image', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(t('hero.edit.uploadFailed'));
      }

      const data = await response.json();
      setEditContent(prev => ({ ...prev, backgroundImage: data.url }));
      setShowImageDialog(false);
      toast.success(t('hero.edit.uploadSuccess'));
    } catch (error) {
      toast.error(t('hero.edit.uploadFailed'));
    } finally {
      setIsUploading(false);
    }
  };

  const handleKeywordsChange = (value: string) => {
    const keywords = value.split(',').map(k => k.trim()).filter(k => k);
    setEditContent(prev => ({ ...prev, hotKeywords: keywords }));
  };

  // 搜尋標籤配置
  const searchTabs = [
    { id: "group", labelKey: "hero.search.tabs.groupTours", icon: <Users className="h-4 w-4" />, locked: false },
    { id: "flight", labelKey: "hero.search.tabs.flights", icon: <Plane className="h-4 w-4" />, locked: true },
    { id: "hotel", labelKey: "hero.search.tabs.hotels", icon: <Hotel className="h-4 w-4" />, locked: true },
  ];

  return (
    <section className="relative w-full h-[600px] md:h-[700px] flex items-center justify-center overflow-hidden">
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <img 
          src={isEditing ? editContent.backgroundImage : content.backgroundImage} 
          alt="Cherry Blossoms Travel" 
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/20" />
        
        {/* Edit Image Button */}
        {isEditMode && canEdit && isEditing && (
          <button
            onClick={() => setShowImageDialog(true)}
            className="absolute top-4 right-4 z-20 bg-black/70 hover:bg-black text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
          >
            <ImageIcon className="h-4 w-4" />
            {t('hero.edit.changeBackground')}
          </button>
        )}
      </div>

      {/* Content */}
      <div className="container relative z-10 flex flex-col items-center pt-10">
        {/* Hero Text */}
        <div className="text-center mb-8 animate-in fade-in zoom-in duration-1000 relative">
          {isEditing ? (
            <div className="space-y-4">
              <input
                type="text"
                value={editContent.subtitle}
                onChange={(e) => setEditContent(prev => ({ ...prev, subtitle: e.target.value }))}
                className="text-white text-xl md:text-2xl font-serif mb-2 tracking-widest text-shadow bg-transparent border-b border-white/50 text-center w-full focus:outline-none focus:border-white"
              />
              <input
                type="text"
                value={editContent.title}
                onChange={(e) => setEditContent(prev => ({ ...prev, title: e.target.value }))}
                className="text-white text-4xl md:text-6xl font-bold font-serif tracking-tight text-shadow-lg bg-transparent border-b border-white/50 text-center w-full focus:outline-none focus:border-white"
              />
            </div>
          ) : (
            <>
              <h2 className="text-white text-xl md:text-2xl font-serif mb-2 tracking-widest text-shadow">
                {content.subtitle || t('hero.subtitle')}
              </h2>
              <h1 className="text-white text-4xl md:text-6xl font-bold font-serif tracking-tight text-shadow-lg">
                {content.title || t('hero.title')}
              </h1>
            </>
          )}
          
          {/* Edit Button */}
          {isEditMode && canEdit && !isEditing && (
            <button
              onClick={() => {
                setEditContent(content);
                setIsEditing(true);
              }}
              className="absolute -top-2 -right-12 bg-black/70 hover:bg-black text-white p-2 rounded-full transition-colors"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Edit Controls */}
        {isEditing && (
          <div className="flex gap-2 mb-4">
            <Button
              onClick={handleSaveContent}
              disabled={updateContentMutation.isPending}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <Check className="h-4 w-4 mr-2" />
              {t('common.save')}
            </Button>
            <Button
              onClick={() => {
                setIsEditing(false);
                setEditContent(content);
              }}
              variant="outline"
              className="bg-white/20 hover:bg-white/30 text-white border-white/50"
            >
              <X className="h-4 w-4 mr-2" />
              {t('common.cancel')}
            </Button>
          </div>
        )}

        {/* Search Console - Lion Travel Style */}
        <div className="w-full max-w-5xl bg-white shadow-2xl animate-in slide-in-from-bottom-10 duration-700 delay-300 rounded-3xl overflow-hidden">
          {/* Tabs */}
          <div className="flex w-full border-b border-gray-200 bg-gray-50 rounded-t-3xl">
            {searchTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  if (tab.locked) {
                    handleLockedTabClick(t(tab.labelKey));
                  } else {
                    setActiveTab(tab.id);
                  }
                }}
                className={`flex-1 py-4 px-2 text-base font-medium transition-all relative flex items-center justify-center gap-2 ${
                  tab.locked 
                    ? "text-gray-400 cursor-not-allowed bg-gray-100" 
                    : activeTab === tab.id 
                      ? "text-primary bg-white border-t-2 border-t-primary" 
                      : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                }`}
              >
                {tab.icon}
                {t(tab.labelKey)}
                {tab.locked && <Lock className="h-3 w-3 ml-1" />}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="p-4 bg-white rounded-b-3xl">
            <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                {/* Use flexbox with equal basis for equal widths */}
                <div className="flex flex-col md:flex-row gap-4 items-end">
                  {/* Departure Location - Changed to Autocomplete */}
                  <div className="w-full" style={{ flex: '1 1 0', minWidth: 0 }}>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('hero.search.departure')}</label>
                    <DepartureAutocomplete 
                      value={departure}
                      onChange={setDeparture}
                      placeholder={t('hero.search.departurePlaceholder')}
                      className="w-full [[&_input]:rounded-full_input]:rounded-lg [&_input]:bg-gray-50 [&_input]:border-gray-200 [&_input]:focus:ring-primary [&_input]:focus:border-primary [&_input]:h-12 [&_input]:w-full"
                    />
                  </div>

                  {/* Keyword Input */}
                  <div className="w-full" style={{ flex: '1 1 0', minWidth: 0 }}>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('hero.search.keyword')}</label>
                    <DestinationAutocomplete 
                      value={destination}
                      onChange={setDestination}
                      onSelect={handleSearch}
                      placeholder={t('hero.search.destinationPlaceholder')}
                      className="w-full [[&_input]:rounded-full_input]:rounded-lg [&_input]:bg-gray-50 [&_input]:border-gray-200 [&_input]:focus:ring-primary [&_input]:focus:border-primary [&_input]:h-12 [&_input]:w-full"
                    />
                  </div>

                  {/* Date Range Picker */}
                  <div className="w-full" style={{ flex: '1 1 0', minWidth: 0 }}>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('hero.search.departureDate')}</label>
                    <DateRangePicker 
                      value={dateRange}
                      onChange={setDateRange}
                      placeholder={t('hero.search.selectDate')}
                      className="h-12 rounded-lg w-full"
                    />
                  </div>

                  {/* Search Button */}
                  <div className="w-full md:w-32 flex-shrink-0">
                    <Button 
                      onClick={handleSearch}
                      className="w-full h-12 bg-black hover:bg-gray-900 text-white rounded-lg font-bold shadow-md transition-all hover:shadow-lg"
                    >
                      {t('hero.search.searchButton')}
                    </Button>
                  </div>
                </div>


                {/* Hot Keywords - Only show for group tours */}
                {activeTab === "group" && (
                  <div className="flex items-center gap-2 text-sm text-gray-500 mt-2 pt-2 border-t border-gray-100">
                    <span className="font-medium text-primary">{t('hero.search.hotKeywords')}：</span>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editContent.hotKeywords.join(', ')}
                        onChange={(e) => handleKeywordsChange(e.target.value)}
                        placeholder={t('hero.edit.keywordsPlaceholder')}
                        className="flex-1 bg-gray-100 px-3 py-1 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {content.hotKeywords.map((keyword) => (
                          <button 
                            key={keyword} 
                            onClick={() => handleKeywordClick(keyword)}
                            className="hover:text-primary hover:underline transition-colors"
                          >
                            {translateKeyword(keyword, language)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
            </div>
          </div>
        </div>
      </div>

      {/* Image Upload Dialog */}
      <Dialog open={showImageDialog} onOpenChange={setShowImageDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('hero.edit.changeBackground')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div 
              className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              {isUploading ? (
                <div className="flex flex-col items-center gap-2">
                  <Spinner size="lg" />
                  <p className="text-sm text-gray-500">{t('hero.edit.uploading')}</p>
                </div>
              ) : (
                <>
                  <Upload className="h-10 w-10 mx-auto text-gray-400 mb-2" />
                  <p className="text-sm text-gray-600">{t('hero.edit.dropImage')}</p>
                  <p className="text-xs text-gray-400 mt-1">{t('hero.edit.imageFormats')}</p>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
            <div>
              <Label>{t('hero.edit.orEnterUrl')}</Label>
              <Input
                type="url"
                placeholder="https://example.com/image.jpg"
                value={editContent.backgroundImage}
                onChange={(e) => setEditContent(prev => ({ ...prev, backgroundImage: e.target.value }))}
                className="mt-1"
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
