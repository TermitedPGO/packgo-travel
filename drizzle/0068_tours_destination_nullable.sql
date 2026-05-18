-- Round 81 fix — `tours.destination` is a legacy NOT NULL field that the
-- new Lion bulk import (and other importers) doesn't set, causing every
-- INSERT to fail with ER_NO_DEFAULT_FOR_FIELD. The field is kept for
-- backwards compat with old rows but new rows should be allowed to leave
-- it NULL — `destinationCity` is the real field now.

ALTER TABLE `tours`
  MODIFY `destination` text NULL;
