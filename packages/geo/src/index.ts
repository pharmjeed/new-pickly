/**
 * الخرائط وETA خلف Adapter — docs/14§1 الطبقة 2 (Routes API، لا مسافة مستقيمة).
 * mock: يقدّر ETA من مسافة haversine × معامل طرق مدني (1.35) بسرعة متوسطة
 * 35 كم/س — كافٍ للتطوير والاختبار، وGoogle Routes يُفعَّل بلصق المفتاح (B4).
 */

export interface Coords {
  lat: number;
  lng: number;
}

export interface RouteEstimate {
  eta_seconds: number;
  distance_m: number;
  provider: string;
}

export interface GeoAdapter {
  readonly provider: string;
  estimateRoute(from: Coords, to: Coords): Promise<RouteEstimate>;
}

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(a: Coords, b: Coords): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)));
}

export class MockGeoAdapter implements GeoAdapter {
  readonly provider = "mock";
  /** معامل تحويل الخط المستقيم لمسافة طرق واقعية */
  private static ROAD_FACTOR = 1.35;
  /** متوسط سرعة مدني كم/س */
  private static AVG_SPEED_KMH = 35;

  async estimateRoute(from: Coords, to: Coords): Promise<RouteEstimate> {
    const straight = haversineMeters(from, to);
    const distance_m = Math.round(straight * MockGeoAdapter.ROAD_FACTOR);
    const eta_seconds = Math.max(
      30,
      Math.round((distance_m / 1000 / MockGeoAdapter.AVG_SPEED_KMH) * 3600)
    );
    return { eta_seconds, distance_m, provider: this.provider };
  }
}

export class GoogleRoutesAdapter implements GeoAdapter {
  readonly provider = "google";
  constructor(private apiKey: string) {}

  async estimateRoute(from: Coords, to: Coords): Promise<RouteEstimate> {
    const res = await fetch(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": "routes.duration,routes.distanceMeters"
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
          destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE"
        })
      }
    );
    if (!res.ok) throw new Error(`Routes API: ${res.status}`);
    const body = (await res.json()) as {
      routes?: Array<{ duration?: string; distanceMeters?: number }>;
    };
    const route = body.routes?.[0];
    if (!route?.duration) throw new Error("Routes API: لا مسار");
    return {
      eta_seconds: Number(route.duration.replace("s", "")),
      distance_m: route.distanceMeters ?? 0,
      provider: this.provider
    };
  }
}

export function createGeoAdapter(): GeoAdapter {
  const provider = process.env.GEO_PROVIDER ?? "mock";
  switch (provider) {
    case "google": {
      const key = process.env.ROUTES_API_KEY;
      if (!key) throw new Error("ROUTES_API_KEY مطلوب مع GEO_PROVIDER=google");
      return new GoogleRoutesAdapter(key);
    }
    case "mock":
    default:
      return new MockGeoAdapter();
  }
}

/**
 * محاكي رحلة — يولّد نقاط GPS من نقطة انطلاق إلى الفرع بسرعة واقعية،
 * يستخدمه الـVertical Slice واختبارات Playwright ومعايرة M-07.
 */
export function* simulateTrip(
  from: Coords,
  to: Coords,
  stepSeconds = 5,
  speedKmh = 35
): Generator<Coords & { speed: number; heading: number; accuracy: number }> {
  const total = haversineMeters(from, to);
  const stepM = (speedKmh / 3.6) * stepSeconds;
  const steps = Math.max(1, Math.ceil(total / stepM));
  const heading = (Math.atan2(to.lng - from.lng, to.lat - from.lat) * 180) / Math.PI;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    yield {
      lat: from.lat + (to.lat - from.lat) * t,
      lng: from.lng + (to.lng - from.lng) * t,
      speed: speedKmh / 3.6,
      heading: (heading + 360) % 360,
      accuracy: 8
    };
  }
}
