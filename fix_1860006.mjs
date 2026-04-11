import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check current state of 1860006 departures
const [deps] = await conn.execute(
  'SELECT id, departureDate, adultPrice, childPriceWithBed, infantPrice, status FROM tourDepartures WHERE tourId = 1860006'
);
console.log('Current 1860006 departures:', JSON.stringify(deps, null, 2));

// Fix prices for all departures of tour 1860006
const [result] = await conn.execute(
  'UPDATE tourDepartures SET adultPrice = 128900, childPriceWithBed = 115000, childPriceNoBed = 105000, infantPrice = 45000, singleRoomSupplement = 25000, updatedAt = ? WHERE tourId = 1860006',
  [new Date()]
);
console.log(`Updated ${result.affectedRows} departure rows for tour 1860006`);

// Verify
const [after] = await conn.execute(
  'SELECT id, departureDate, adultPrice, status FROM tourDepartures WHERE tourId = 1860006'
);
console.log('After fix:', JSON.stringify(after.map(d => ({
  id: d.id,
  date: d.departureDate,
  price: d.adultPrice,
  status: d.status
})), null, 2));

await conn.end();
console.log('Done!');
