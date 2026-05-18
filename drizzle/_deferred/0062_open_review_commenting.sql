-- Round 80.25 — open commenting on tour reviews.
--
-- Before: tourReviews.bookingId NOT NULL + UNIQUE constraint = each row must
--   tie back to a real completed booking (one review per purchase).
-- After: bookingId nullable + UNIQUE constraint dropped. Logged-in users can
--   post reviews/comments without a prior booking. Admin moderation queue
--   stays the same; spam is filtered by the pending → approved workflow.
--
-- New compound unique on (userId, tourId) prevents one user spamming a
-- single tour with 100+ reviews. Booking-tied reviews still deduplicated
-- by the new constraint when bookingId is set, since (userId, tourId) is
-- still per-user-per-tour.

ALTER TABLE tourReviews MODIFY COLUMN bookingId INT NULL;

-- Drop old per-booking unique constraint
ALTER TABLE tourReviews DROP INDEX uq_review_booking;

-- New compound unique: 1 review per (user, tour) regardless of booking source.
-- Existing rows: there shouldn't be duplicates since old UNIQUE prevented them
-- via bookingId, and (userId, tourId) was implicitly 1:1 with bookingId.
ALTER TABLE tourReviews ADD CONSTRAINT uq_review_user_tour UNIQUE (userId, tourId);
