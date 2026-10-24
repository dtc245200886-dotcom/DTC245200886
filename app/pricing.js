const ROAD_DISTANCE_FACTOR = 1.25;
const EARTH_RADIUS_KM = 6371;

const VEHICLE_TARIFFS = {
  standard: { baseFare: 12000, perKm: 12000, minimumFare: 30000, averageSpeedKmh: 25 },
  premium: { baseFare: 25000, perKm: 16500, minimumFare: 50000, averageSpeedKmh: 23 },
  xl: { baseFare: 30000, perKm: 20000, minimumFare: 65000, averageSpeedKmh: 22 },
  bike: { baseFare: 5000, perKm: 6500, minimumFare: 15000, averageSpeedKmh: 24 },
};

function isValidCoordinate(latitude, longitude) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

function estimateTrip(pickup, dropoff, vehicleType) {
  if (!Array.isArray(pickup) || !Array.isArray(dropoff)
      || !isValidCoordinate(pickup[0], pickup[1])
      || !isValidCoordinate(dropoff[0], dropoff[1])) {
    throw new TypeError('Invalid route coordinates');
  }

  const tariff = VEHICLE_TARIFFS[vehicleType];
  if (!tariff) throw new RangeError('Unsupported vehicle type');

  const toRadians = degrees => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(dropoff[0] - pickup[0]);
  const longitudeDelta = toRadians(dropoff[1] - pickup[1]);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(pickup[0])) * Math.cos(toRadians(dropoff[0]))
    * Math.sin(longitudeDelta / 2) ** 2;
  const straightLineKm = 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, haversine)));
  const distanceKm = straightLineKm * ROAD_DISTANCE_FACTOR;
  const rawFare = tariff.baseFare + distanceKm * tariff.perKm;
  const fare = Math.ceil(Math.max(tariff.minimumFare, rawFare) / 1000) * 1000;
  const durationMinutes = Math.max(3, Math.ceil(distanceKm / tariff.averageSpeedKmh * 60));

  return {
    distanceKm: Number(distanceKm.toFixed(2)),
    durationMinutes,
    fare,
  };
}

module.exports = { VEHICLE_TARIFFS, estimateTrip, isValidCoordinate };
