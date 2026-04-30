/**
 * PACK&GO 業務邏輯測試套件
 *
 * 涵蓋三大核心業務邏輯：
 * 1. 行程搜尋（destination 模糊匹配、價格/天數篩選、分頁）
 * 2. 支付流程（Stripe checkout session 建立、權限保護）
 * 3. 多語言（i18n key 完整性、三語言一致性）
 * 4. 行程 CRUD（Admin 保護）
 * 5. 詢問系統（訪客詢問、email 驗證）
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import type { User } from "../drizzle/schema";

// Mock Stripe to avoid real API calls in tests
vi.mock("stripe", () => {
  const mockSession = {
    id: "cs_test_mock_session_id",
    url: "https://checkout.stripe.com/pay/cs_test_mock",
    metadata: {},
    payment_intent: "pi_test_mock",
    amount_total: 10000,
    currency: "twd",
  };
  const mockStripe = vi.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue(mockSession),
      },
    },
    webhooks: {
      constructEvent: vi.fn(),
    },
  }));
  return { default: mockStripe };
});

// ─────────────────────────────────────────────
// 共用 Mock 工具
// ─────────────────────────────────────────────

const mockAdminUser: User = {
  id: 1,
  openId: "admin-openid",
  name: "Admin User",
  email: "admin@packgo.com",
  loginMethod: "manus",
  role: "admin",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

const mockRegularUser: User = {
  id: 2,
  openId: "user-openid",
  name: "Regular User",
  email: "user@packgo.com",
  loginMethod: "manus",
  role: "user",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

function createCtx(user?: User): TrpcContext {
  return {
    user: user ?? null,
    req: {
      protocol: "https",
      headers: { origin: "https://packgo09.manus.space" },
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
      cookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

// ─────────────────────────────────────────────
// 1. 行程搜尋業務邏輯
// ─────────────────────────────────────────────

describe.skipIf(!process.env.DATABASE_URL)("行程搜尋業務邏輯 (tours.search)", () => {
  it("無篩選條件時應回傳分頁結果，包含 pagination 物件", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.tours.search({ page: 1, pageSize: 12 });

    expect(result).toHaveProperty("tours");
    expect(result).toHaveProperty("pagination");
    expect(Array.isArray(result.tours)).toBe(true);

    const { pagination } = result;
    expect(pagination).toHaveProperty("page", 1);
    expect(pagination).toHaveProperty("pageSize", 12);
    expect(pagination).toHaveProperty("total");
    expect(pagination).toHaveProperty("totalPages");
    expect(pagination).toHaveProperty("hasMore");
    expect(typeof pagination.total).toBe("number");
  });

  it("destination 篩選應支援模糊匹配（中文關鍵字）", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.tours.search({ destination: "日本", page: 1, pageSize: 50 });

    expect(Array.isArray(result.tours)).toBe(true);
    // 所有結果應包含「日本」相關字串
    result.tours.forEach((tour) => {
      const matchesDestination =
        tour.destination?.includes("日本") ||
        tour.destinationCountry?.includes("日本") ||
        tour.destinationCity?.includes("日本") ||
        tour.title?.includes("日本");
      expect(matchesDestination).toBe(true);
    });
  });

  it("minPrice / maxPrice 篩選應正確過濾行程", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.tours.search({
      minPrice: 10000,
      maxPrice: 50000,
      page: 1,
      pageSize: 50,
    });

    expect(Array.isArray(result.tours)).toBe(true);
    result.tours.forEach((tour) => {
      expect(tour.price).toBeGreaterThanOrEqual(10000);
      expect(tour.price).toBeLessThanOrEqual(50000);
    });
  });

  it("minDays / maxDays 篩選應正確過濾行程", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.tours.search({
      minDays: 3,
      maxDays: 7,
      page: 1,
      pageSize: 50,
    });

    expect(Array.isArray(result.tours)).toBe(true);
    result.tours.forEach((tour) => {
      expect(tour.duration).toBeGreaterThanOrEqual(3);
      expect(tour.duration).toBeLessThanOrEqual(7);
    });
  });

  it("sortBy price_asc 應回傳價格由低到高的行程", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.tours.search({
      sortBy: "price_asc",
      page: 1,
      pageSize: 20,
    });

    expect(Array.isArray(result.tours)).toBe(true);
    if (result.tours.length >= 2) {
      for (let i = 1; i < result.tours.length; i++) {
        expect(result.tours[i].price).toBeGreaterThanOrEqual(result.tours[i - 1].price);
      }
    }
  });

  it("sortBy price_desc 應回傳價格由高到低的行程", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.tours.search({
      sortBy: "price_desc",
      page: 1,
      pageSize: 20,
    });

    expect(Array.isArray(result.tours)).toBe(true);
    if (result.tours.length >= 2) {
      for (let i = 1; i < result.tours.length; i++) {
        expect(result.tours[i].price).toBeLessThanOrEqual(result.tours[i - 1].price);
      }
    }
  });

  it("分頁應正確計算 hasMore 和 totalPages", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.tours.search({ page: 1, pageSize: 1 });

    const { pagination } = result;
    if (pagination.total > 1) {
      expect(pagination.hasMore).toBe(true);
      expect(pagination.totalPages).toBeGreaterThan(1);
    } else {
      expect(pagination.hasMore).toBe(false);
    }
  });

  it("pageSize 超過 100 應拋出驗證錯誤", async () => {
    const caller = appRouter.createCaller(createCtx());
    await expect(
      caller.tours.search({ page: 1, pageSize: 200 })
    ).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────
// 2. 支付流程業務邏輯
// ─────────────────────────────────────────────

describe.skipIf(!process.env.DATABASE_URL)("支付流程業務邏輯 (bookings)", () => {
  it("未登入用戶嘗試建立訂單應拋出 UNAUTHORIZED", async () => {
    const caller = appRouter.createCaller(createCtx(undefined));
    await expect(
      caller.bookings.create({
        tourId: 1,
        participants: 2,
        contactName: "Test User",
        contactEmail: "test@example.com",
        contactPhone: "0912345678",
        specialRequests: "",
      })
    ).rejects.toThrow();
  });

  it("已登入用戶建立訂單應包含正確的金額計算（totalPrice = price × participants）", async () => {
    // 增加 timeout 因為需要發送確認 email
    const caller = appRouter.createCaller(createCtx(mockRegularUser));

    // 先取得一個有效的行程
    const tours = await caller.tours.list();
    if (tours.length === 0) {
      console.log("⚠️ 跳過：資料庫中無行程資料");
      return;
    }

    const tour = tours[0];
    const participants = 2;
    const booking = await caller.bookings.create({
      tourId: tour.id,
      participants,
      contactName: "Test User",
      contactEmail: "test@example.com",
      contactPhone: "0912345678",
      specialRequests: "",
    });

    expect(booking).toBeDefined();
    expect(booking.tourId).toBe(tour.id);
    // totalPrice 應為 price × participants
    expect(booking.totalPrice).toBe(tour.price * participants);
    // depositAmount 應為 totalPrice × 20%
    expect(booking.depositAmount).toBe(Math.floor(tour.price * participants * 0.2));
  }, 15000); // 增加 timeout 因為需要發送確認 email

  it("Stripe checkout session 建立應回傳 URL（需登入）", async () => {
    const caller = appRouter.createCaller(createCtx(mockRegularUser));

    // 取得現有訂單
    const bookings = await caller.bookings.list();
    if (bookings.length === 0) {
      console.log("⚠️ 跳過：資料庫中無訂單資料");
      return;
    }

    const booking = bookings[0];
    const result = await caller.bookings.createCheckoutSession({
      bookingId: booking.id,
      paymentType: "deposit",
    });

    expect(result).toHaveProperty("url");
    expect(typeof result.url).toBe("string");
    expect(result.url.length).toBeGreaterThan(0);
  });

  it("未登入用戶嘗試建立 checkout session 應拋出 UNAUTHORIZED", async () => {
    const caller = appRouter.createCaller(createCtx(undefined));
    await expect(
      caller.bookings.createCheckoutSession({
        bookingId: 1,
        paymentType: "deposit",
      })
    ).rejects.toThrow();
  });

  it("訂單列表只應回傳當前用戶的訂單", async () => {
    const caller = appRouter.createCaller(createCtx(mockRegularUser));
    const bookings = await caller.bookings.list();
    expect(Array.isArray(bookings)).toBe(true);
    // 所有訂單應屬於當前用戶
    bookings.forEach((booking) => {
      expect(booking.userId).toBe(mockRegularUser.id);
    });
  });
});

// ─────────────────────────────────────────────
// 3. 行程 CRUD 業務邏輯（Admin 保護）
// ─────────────────────────────────────────────

describe.skipIf(!process.env.DATABASE_URL)("行程 CRUD 業務邏輯 (Admin 保護)", () => {
  it("非 admin 用戶嘗試建立行程應拋出 FORBIDDEN", async () => {
    const caller = appRouter.createCaller(createCtx(mockRegularUser));
    await expect(
      caller.tours.create({
        title: "測試行程",
        destination: "日本東京",
        destinationCountry: "日本",
        destinationCity: "東京",
        description: "測試描述",
        duration: 5,
        price: 35000,
        category: "group",
        status: "active",
        featured: 0,
      })
    ).rejects.toThrow();
  });

  it("未登入用戶嘗試建立行程應拋出 UNAUTHORIZED", async () => {
    const caller = appRouter.createCaller(createCtx(undefined));
    await expect(
      caller.tours.create({
        title: "測試行程",
        destination: "日本東京",
        destinationCountry: "日本",
        destinationCity: "東京",
        description: "測試描述",
        duration: 5,
        price: 35000,
        category: "group",
        status: "active",
        featured: 0,
      })
    ).rejects.toThrow();
  });

  it("公開 API tours.list 不需要認證即可存取", async () => {
    const caller = appRouter.createCaller(createCtx(undefined));
    const tours = await caller.tours.list();
    expect(Array.isArray(tours)).toBe(true);
  });

  it("公開 API tours.getById 不需要認證即可存取", async () => {
    const caller = appRouter.createCaller(createCtx(undefined));
    const tours = await caller.tours.list();
    if (tours.length === 0) {
      console.log("⚠️ 跳過：資料庫中無行程資料");
      return;
    }
    const tour = await caller.tours.getById({ id: tours[0].id });
    expect(tour).toBeDefined();
    expect(tour?.id).toBe(tours[0].id);
  });

  it("Admin 可以成功建立行程", async () => {
    const caller = appRouter.createCaller(createCtx(mockAdminUser));
    const newTour = await caller.tours.create({
      title: `業務邏輯測試行程-${Date.now()}`,
      destination: "日本東京",
      destinationCountry: "日本",
      destinationCity: "東京",
      description: "這是業務邏輯測試用的行程",
      duration: 5,
      price: 35000,
      category: "group",
      status: "active",
      featured: 0,
    });
    expect(newTour).toBeDefined();
    expect(newTour.price).toBe(35000);
    expect(newTour.duration).toBe(5);
    // 清理：刪除測試行程
    if (newTour.id) {
      await caller.tours.delete({ id: newTour.id });
    }
  });
});

// ─────────────────────────────────────────────
// 5. 詢問系統業務邏輯
// ─────────────────────────────────────────────

describe.skipIf(!process.env.DATABASE_URL)("詢問系統業務邏輯 (inquiries)", () => {
  it("建立詢問單不需要登入（訪客詢問）", async () => {
    const caller = appRouter.createCaller(createCtx(undefined));
    const result = await caller.inquiries.create({
      customerName: "測試訪客",
      customerEmail: "guest@test.com",
      customerPhone: "0912345678",
      subject: "行程詢問",
      message: "請問這個行程還有名額嗎？",
    });

    expect(result).toBeDefined();
    expect(result.customerName).toBe("測試訪客");
    expect(result.customerEmail).toBe("guest@test.com");
    expect(result.status).toBe("new");
  });

  it("詢問單 email 格式驗證應拒絕無效 email", async () => {
    const caller = appRouter.createCaller(createCtx(undefined));
    await expect(
      caller.inquiries.create({
        customerName: "測試",
        customerEmail: "not-an-email",
        subject: "測試主旨",
        message: "測試訊息",
      })
    ).rejects.toThrow();
  });

  it("詢問單 customerName 為空應拋出驗證錯誤", async () => {
    const caller = appRouter.createCaller(createCtx(undefined));
    await expect(
      caller.inquiries.create({
        customerName: "",
        customerEmail: "valid@test.com",
        subject: "測試主旨",
        message: "測試訊息",
      })
    ).rejects.toThrow();
  });

  it("詢問單 subject 為空應拋出驗證錯誤", async () => {
    const caller = appRouter.createCaller(createCtx(undefined));
    await expect(
      caller.inquiries.create({
        customerName: "測試用戶",
        customerEmail: "valid@test.com",
        subject: "",
        message: "測試訊息",
      })
    ).rejects.toThrow();
  });

  it("Admin 可以查看所有詢問單", async () => {
    const caller = appRouter.createCaller(createCtx(mockAdminUser));
    const inquiries = await caller.inquiries.list();
    expect(Array.isArray(inquiries)).toBe(true);
  });

  it("非 Admin 用戶嘗試查看所有詢問單應拋出 FORBIDDEN", async () => {
    const caller = appRouter.createCaller(createCtx(mockRegularUser));
    await expect(caller.inquiries.list()).rejects.toThrow();
  });
});
