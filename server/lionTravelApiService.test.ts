/**
 * Round 50: Unit tests for lionTravelApiService
 * Tests cover: URL detection, data parsing, fallback behavior, and content building
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchLionTravelData, buildRawContentFromLionData } from './services/lionTravelApiService';

// ─── Mock fetch ──────────────────────────────────────────────────────────────

const mockTravelInfoResponse = {
  GroupInfo: {
    GroupID: 'TEST001',
    TourID: '25TESTID',
    TourName: '四國四鐵道深度7日',
    TourDays: 7,
    GoDate: '2026/05/01',
    BackDate: '2026/05/07',
    Price: '89,900',
    StraightLowestPrice: 89900,
    CurrencyCode: 'TWD',
    TotalSeats: 30,
    SpareSeats: 10,
    NormGroupImg: 'https://example.com/hero.jpg',
    GoAirline: '長榮航空',
    GoDepartureTime: '08:00',
    GoArriveTime: '12:00',
    GoDepartureAirport: 'TPE',
    GoArriveAirport: 'NRT',
    BackAirline: '長榮航空',
    BackDepartureTime: '14:00',
    BackArriveTime: '18:00',
    BackDepartureAirport: 'NRT',
    BackArriveAirport: 'TPE',
    TagList: ['四國', '鐵道', '文化'],
    TripTypeList: ['深度旅遊'],
    StartFromCityList: ['台北'],
  },
};

const mockDaytripResponse = {
  TourName: '四國四鐵道深度7日',
  TourDays: 7,
  Features: '<p>行程特色：四國鐵道之旅</p>',
  DailyList: [
    {
      Day: 1,
      TravelPoint: '台北→高松',
      SpecialNote: '抵達高松機場',
      Summary: '搭乘長榮航空前往高松，辦理入住手續',
      Breakfast: '',
      Lunch: '',
      Dinner: '飯店餐廳',
      HotelList: [{ HotelName: '高松東急REI飯店' }],
      AttractionsList: [
        { Name: '高松機場', VisitWayDesc: '入境', ImgUrl: '' },
      ],
    },
    {
      Day: 2,
      TravelPoint: '高松→琴平→高知',
      SpecialNote: '',
      Summary: '搭乘土讚線前往琴平，參觀金刀比羅宮',
      Breakfast: '飯店早餐',
      Lunch: '讚岐烏龍麵',
      Dinner: '土佐料理',
      HotelList: [{ HotelName: '高知三井花園飯店' }],
      AttractionsList: [
        { Name: '金刀比羅宮', VisitWayDesc: '參拜785階石段', ImgUrl: 'https://example.com/kotohira.jpg' },
      ],
    },
  ],
};

const mockPriceResponse = {
  TourDays: 7,
  StraightLowestPrice: 89900,
  CurrencyCode: 'TWD',
  OrderPrice: 20000,
  StraightRemarks: '單人加房差價 NT$15,000',
  MultiPricesList: [
    {
      GroupPricesList: [
        {
          AdultsPriceOrig: 89900,
          ChildrenWithBedOrig: 79900,
          ChildrenNoPriceOrig: 69900,
          BabyPriceOrig: 10000,
        },
      ],
    },
  ],
};

const mockNoticeResponse = {
  NoteList: [
    {
      Title: 'cancellation',
      CTitle: '取消規定',
      Desc: '<p>出發前30天取消，退還全額團費</p>',
    },
  ],
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('fetchLionTravelData', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns null for non-liontravel URLs', async () => {
    const result = await fetchLionTravelData('https://www.example.com/tour/123');
    expect(result).toBeNull();
  });

  it('returns null for liontravel URL without NormGroupID', async () => {
    const result = await fetchLionTravelData('https://travel.liontravel.com/detail');
    expect(result).toBeNull();
  });

  it('returns null when travelinfojson returns no GroupID', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ GroupInfo: {} }),
    }));
    const result = await fetchLionTravelData(
      'https://travel.liontravel.com/detail?NormGroupID=test-id'
    );
    expect(result).toBeNull();
  });

  it('successfully fetches and parses tour data', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => mockTravelInfoResponse })
      .mockResolvedValueOnce({ ok: true, json: async () => mockDaytripResponse })
      .mockResolvedValueOnce({ ok: true, json: async () => mockPriceResponse })
      .mockResolvedValueOnce({ ok: true, json: async () => mockNoticeResponse });

    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchLionTravelData(
      'https://travel.liontravel.com/detail?NormGroupID=test-norm-id'
    );

    expect(result).not.toBeNull();
    expect(result!.tourName).toBe('四國四鐵道深度7日');
    expect(result!.tourDays).toBe(7);
    expect(result!.groupId).toBe('TEST001');
    expect(result!.normGroupId).toBe('test-norm-id');
    expect(result!.currencyCode).toBe('TWD');
  });

  it('correctly extracts pricing from MultiPricesList', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => mockTravelInfoResponse })
      .mockResolvedValueOnce({ ok: true, json: async () => mockDaytripResponse })
      .mockResolvedValueOnce({ ok: true, json: async () => mockPriceResponse })
      .mockResolvedValueOnce({ ok: true, json: async () => mockNoticeResponse });

    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchLionTravelData(
      'https://travel.liontravel.com/detail?NormGroupID=test-norm-id'
    );

    expect(result!.pricing.adultPrice).toBe(89900);
    expect(result!.pricing.childWithBed).toBe(79900);
    expect(result!.pricing.deposit).toBe(20000);
    expect(result!.pricing.singleSupplement).toBe('單人加房差價 NT$15,000');
    expect(result!.pricing.currencyCode).toBe('TWD');
  });

  it('correctly maps daily itinerary with hotels and meals', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => mockTravelInfoResponse })
      .mockResolvedValueOnce({ ok: true, json: async () => mockDaytripResponse })
      .mockResolvedValueOnce({ ok: true, json: async () => mockPriceResponse })
      .mockResolvedValueOnce({ ok: true, json: async () => mockNoticeResponse });

    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchLionTravelData(
      'https://travel.liontravel.com/detail?NormGroupID=test-norm-id'
    );

    expect(result!.dailyItinerary).toHaveLength(2);
    
    const day1 = result!.dailyItinerary[0];
    expect(day1.day).toBe(1);
    expect(day1.travelPoint).toBe('台北→高松');
    expect(day1.hotelName).toBe('高松東急REI飯店');
    expect(day1.dinner).toBe('飯店餐廳');
    
    const day2 = result!.dailyItinerary[1];
    expect(day2.breakfast).toBe('飯店早餐');
    expect(day2.lunch).toBe('讚岐烏龍麵');
    expect(day2.dinner).toBe('土佐料理');
    expect(day2.attractions).toHaveLength(1);
    expect(day2.attractions[0].name).toBe('金刀比羅宮');
  });

  it('correctly maps flights', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => mockTravelInfoResponse })
      .mockResolvedValueOnce({ ok: true, json: async () => mockDaytripResponse })
      .mockResolvedValueOnce({ ok: true, json: async () => mockPriceResponse })
      .mockResolvedValueOnce({ ok: true, json: async () => mockNoticeResponse });

    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchLionTravelData(
      'https://travel.liontravel.com/detail?NormGroupID=test-norm-id'
    );

    expect(result!.outboundFlight.airline).toBe('長榮航空');
    expect(result!.outboundFlight.departureAirport).toBe('TPE');
    expect(result!.outboundFlight.arriveAirport).toBe('NRT');
    expect(result!.returnFlight.arriveAirport).toBe('TPE');
  });

  it('correctly parses notices', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => mockTravelInfoResponse })
      .mockResolvedValueOnce({ ok: true, json: async () => mockDaytripResponse })
      .mockResolvedValueOnce({ ok: true, json: async () => mockPriceResponse })
      .mockResolvedValueOnce({ ok: true, json: async () => mockNoticeResponse });

    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchLionTravelData(
      'https://travel.liontravel.com/detail?NormGroupID=test-norm-id'
    );

    expect(result!.notices).toHaveLength(1);
    expect(result!.notices[0].chineseTitle).toBe('取消規定');
    expect(result!.notices[0].content).toContain('出發前30天取消');
  });

  it('returns null and logs warning when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await fetchLionTravelData(
      'https://travel.liontravel.com/detail?NormGroupID=test-norm-id'
    );

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[LionAPI] fetchLionTravelData failed')
    );
    consoleSpy.mockRestore();
  });
});

// ─── buildRawContentFromLionData tests ───────────────────────────────────────

describe('buildRawContentFromLionData', () => {
  const sampleData = {
    tourName: '四國四鐵道深度7日',
    tourId: '25TESTID',
    normGroupId: 'test-norm-id',
    groupId: 'TEST001',
    tourDays: 7,
    goDate: '2026/05/01',
    backDate: '2026/05/07',
    price: 89900,
    currencyCode: 'TWD',
    totalSeats: 30,
    spareSeats: 10,
    heroImageUrl: 'https://example.com/hero.jpg',
    tags: ['四國', '鐵道'],
    tripTypes: ['深度旅遊'],
    departureCity: '台北',
    outboundFlight: {
      airline: '長榮航空',
      departureTime: '08:00',
      arriveTime: '12:00',
      departureAirport: 'TPE',
      arriveAirport: 'NRT',
    },
    returnFlight: {
      airline: '長榮航空',
      departureTime: '14:00',
      arriveTime: '18:00',
      departureAirport: 'NRT',
      arriveAirport: 'TPE',
    },
    dailyItinerary: [
      {
        day: 1,
        travelPoint: '台北→高松',
        specialNote: '抵達高松機場',
        summary: '搭乘長榮航空前往高松',
        breakfast: '',
        lunch: '',
        dinner: '飯店餐廳',
        hotelName: '高松東急REI飯店',
        attractions: [{ name: '高松機場', visitWayDesc: '入境', imgUrl: '' }],
      },
    ],
    pricing: {
      adultPrice: 89900,
      childWithBed: 79900,
      childNoBed: 69900,
      babyPrice: 10000,
      deposit: 20000,
      singleSupplement: '單人加房差價 NT$15,000',
      currencyCode: 'TWD',
    },
    notices: [
      { title: 'cancellation', chineseTitle: '取消規定', content: '出發前30天取消，退還全額團費' },
    ],
    featuresHtml: '<p>行程特色</p>',
  };

  it('includes tour name and basic info', () => {
    const content = buildRawContentFromLionData(sampleData);
    expect(content).toContain('四國四鐵道深度7日');
    expect(content).toContain('7天');
    expect(content).toContain('89,900 TWD');
  });

  it('includes flight information', () => {
    const content = buildRawContentFromLionData(sampleData);
    expect(content).toContain('長榮航空');
    expect(content).toContain('TPE');
    expect(content).toContain('NRT');
  });

  it('includes daily itinerary', () => {
    const content = buildRawContentFromLionData(sampleData);
    expect(content).toContain('第1天');
    expect(content).toContain('台北→高松');
    expect(content).toContain('高松東急REI飯店');
    expect(content).toContain('高松機場');
  });

  it('includes meal information', () => {
    const content = buildRawContentFromLionData(sampleData);
    expect(content).toContain('晚餐：飯店餐廳');
  });

  it('includes notices', () => {
    const content = buildRawContentFromLionData(sampleData);
    expect(content).toContain('取消規定');
    expect(content).toContain('出發前30天取消');
  });

  it('does not include price line when price is 0', () => {
    const noPrice = { ...sampleData, price: 0 };
    const content = buildRawContentFromLionData(noPrice);
    expect(content).not.toContain('價格：');
  });
});
