const test = require('node:test');
const assert = require('node:assert/strict');
const { estimateTrip, isValidCoordinate } = require('./pricing');

test('estimates a route and rounds fares up to 1,000 VND', () => {
  const estimate = estimateTrip([0, 0], [0, 0.01], 'standard');

  assert.ok(estimate.distanceKm > 1.3 && estimate.distanceKm < 1.5);
  assert.ok(estimate.durationMinutes >= 3);
  assert.equal(estimate.fare % 1000, 0);
  assert.ok(estimate.fare >= 30000);
});

test('uses the vehicle minimum fare for a zero-length route', () => {
  assert.equal(estimateTrip([21.5, 105.8], [21.5, 105.8], 'bike').fare, 15000);
});

test('rejects invalid coordinates and unknown vehicle types', () => {
  assert.equal(isValidCoordinate(91, 0), false);
  assert.throws(() => estimateTrip([0, 0], [0, 1], 'plane'), RangeError);
  assert.throws(() => estimateTrip([NaN, 0], [0, 1], 'standard'), TypeError);
});
