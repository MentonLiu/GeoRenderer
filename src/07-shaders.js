	const VS_FULLSCREEN = `#version 300 es
void main() {
	vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
	gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

	const FS_PATHTRACE = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

#define PI 3.141592653589793
#define INV_PI 0.3183098861837907
#define TFAR 1.0e20
#define RAY_EPS 1.0e-3

#define MF_HAS_COLOR   1
#define MF_HAS_MER     2
#define MF_HAS_NORMAL  4
#define MF_FULLBRIGHT  8
#define MF_WRAP_REPEAT 16
#define MF_ADDITIVE    32
#define MF_HAS_EMISSIVE_MAP 64
#define MF_EMIS_MAIN_COLOR  128
#define MF_EMIS_CUSTOM_COLOR 256

uniform vec2 uResolution;
uniform int  uSeed;
uniform int  uMaxBounce;
uniform int  uLightSamples;
uniform float uClamp;
uniform int  uFilterLinear;

uniform vec3 uCamPos, uCamRight, uCamUp, uCamForward;
uniform float uTanHalfFov, uAspect, uOrthoHalfHeight;
uniform int  uOrtho;
uniform float uAperture, uFocusDist;

uniform sampler2D uTriPos;
uniform sampler2D uTriAttr;
uniform sampler2D uBVH;
uniform sampler2D uMat;
uniform sampler2D uAtlasC;
uniform sampler2D uAtlasM;
uniform sampler2D uAtlasN;
uniform sampler2D uAtlasE;
uniform sampler2D uLightTex;
uniform int uTriPosW, uTriAttrW, uBVHW, uMatW, uLightW;
uniform int uTriCount, uLightCount;

uniform sampler2D uEnv;
uniform sampler2D uEnvCond;
uniform sampler2D uEnvMarg;
uniform ivec2 uEnvDist;
uniform float uEnvIntensity, uEnvRotation;
uniform int uBgMode;
uniform vec3 uBgColor;

uniform int  uSunEnable;
uniform vec3 uSunDir;
uniform float uSunCosRadius, uSunSolidAngle;
uniform vec3 uSunRadiance;

uniform int  uGroundOn, uGroundCatcher;
uniform float uGroundY, uGroundRough, uGroundMetal, uGroundRadius;
uniform vec3 uGroundColor;

uniform sampler2D uAccum;
#ifndef PTR_COLOR_ONLY
uniform sampler2D uAccumAlb;
uniform sampler2D uAccumNrm;
uniform sampler2D uAccumMom;
#endif
uniform int uReset;

layout(location = 0) out vec4 outColor;
#ifndef PTR_COLOR_ONLY
layout(location = 1) out vec4 outAlbedo;
layout(location = 2) out vec4 outNormal;
layout(location = 3) out vec4 outMoment;
#endif

uint g_rng;
uint pcgNext() {
	g_rng = g_rng * 747796405u + 2891336453u;
	uint w = ((g_rng >> ((g_rng >> 28u) + 4u)) ^ g_rng) * 277803737u;
	return (w >> 22u) ^ w;
}
float rnd() { return float(pcgNext()) * (1.0 / 4294967296.0); }
vec2 rnd2() { return vec2(rnd(), rnd()); }

vec4 fetchAt(sampler2D s, int idx, int w) {
	return texelFetch(s, ivec2(idx - (idx / w) * w, idx / w), 0);
}
vec4 fTri(int i) { return fetchAt(uTriPos, i, uTriPosW); }
vec4 fAttr(int i) { return fetchAt(uTriAttr, i, uTriAttrW); }
vec4 fBVH(int i) { return fetchAt(uBVH, i, uBVHW); }
vec4 fMat(int i) { return fetchAt(uMat, i, uMatW); }
int triCullMode(int tri) { return int(fTri(tri * 3 + 1).w + 0.5); }
bool isNegativeCubeTri(int tri) { return triCullMode(tri) >= 3; }
bool isInsideOnlyTri(int tri) {
	return triCullMode(tri) == 6;
}

struct Mat {
	vec3 tint;
	int flags;
	vec4 rect;
	float rough, metal, emis, ior;
	float transm, cutoff, nscale;
	int amode;
	vec3 emisColor;
};

Mat loadMat(int id) {
	vec4 m0 = fMat(id * 5 + 0);
	vec4 m1 = fMat(id * 5 + 1);
	vec4 m2 = fMat(id * 5 + 2);
	vec4 m3 = fMat(id * 5 + 3);
	vec4 m4 = fMat(id * 5 + 4);
	Mat m;
	m.tint = m0.rgb;
	m.flags = int(m0.a + 0.5);
	m.rect = m1;
	m.rough = m2.x; m.metal = m2.y; m.emis = m2.z; m.ior = m2.w;
	m.transm = m3.x; m.cutoff = m3.y; m.nscale = m3.z;
	m.amode = int(m3.w + 0.5);
	m.emisColor = m4.rgb;
	return m;
}

vec3 srgbToLin(vec3 c) {
	return mix(c / 12.92, pow(max(c + 0.055, vec3(0.0)) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

vec4 fetchAtlas(sampler2D atlas, vec4 rect, vec2 f, bool rep) {
	vec2 sz = max(rect.zw, vec2(1.0));
	if (rep) f = mod(f, sz);
	f = clamp(f, vec2(0.0), sz - 1.0);
	return texelFetch(atlas, ivec2(rect.xy + f), 0);
}

vec4 sampleAtlas(sampler2D atlas, vec4 rect, vec2 uvIn, bool rep) {
	vec2 uv = vec2(uvIn.x, 1.0 - uvIn.y);
	vec2 sz = max(rect.zw, vec2(1.0));
	if (uFilterLinear == 0) {
		return fetchAtlas(atlas, rect, floor(uv * sz), rep);
	}
	vec2 t = uv * sz - 0.5;
	vec2 f0 = floor(t);
	vec2 fr = t - f0;
	vec4 c00 = fetchAtlas(atlas, rect, f0, rep);
	vec4 c10 = fetchAtlas(atlas, rect, f0 + vec2(1.0, 0.0), rep);
	vec4 c01 = fetchAtlas(atlas, rect, f0 + vec2(0.0, 1.0), rep);
	vec4 c11 = fetchAtlas(atlas, rect, f0 + vec2(1.0, 1.0), rep);
	return mix(mix(c00, c10, fr.x), mix(c01, c11, fr.x), fr.y);
}

struct Hit {
	float t;
	int tri;
	vec2 bc;
};

bool hitAABB(vec3 bmin, vec3 bmax, vec3 ro, vec3 invD, float tmax) {
	vec3 t0 = (bmin - ro) * invD;
	vec3 t1 = (bmax - ro) * invD;
	vec3 ts = min(t0, t1);
	vec3 tb = max(t0, t1);
	float tn = max(max(ts.x, ts.y), max(ts.z, 0.0));
	float tf = min(min(tb.x, tb.y), min(tb.z, tmax));
	return tn <= tf;
}

void triIntersect(int i, vec3 ro, vec3 rd, inout Hit hit) {
	vec3 v0 = fTri(i * 3 + 0).xyz;
	vec4 p1 = fTri(i * 3 + 1);
	vec3 v1 = p1.xyz;
	vec3 v2 = fTri(i * 3 + 2).xyz;
	vec3 e1 = v1 - v0;
	vec3 e2 = v2 - v0;
	vec3 pv = cross(rd, e2);
	float det = dot(e1, pv);
	int cull = int(p1.w + 0.5);
	if (cull >= 6) cull = 0;
	else if (cull >= 3) cull -= 3;
	if (cull == 1 && det <= 0.0) return;
	if (cull == 2 && det >= 0.0) return;
	if (abs(det) < 1e-12) return;
	float inv = 1.0 / det;
	vec3 tv = ro - v0;
	float u = dot(tv, pv) * inv;
	if (u < 0.0 || u > 1.0) return;
	vec3 qv = cross(tv, e1);
	float v = dot(rd, qv) * inv;
	if (v < 0.0 || u + v > 1.0) return;
	float t = dot(e2, qv) * inv;
	if (t > 1e-4 && t < hit.t) {
		hit.t = t; hit.tri = i; hit.bc = vec2(u, v);
	}
}

vec3 safeInvDir(vec3 d) {
	const float e = 1e-9;
	vec3 s = vec3(d.x < 0.0 ? -e : e, d.y < 0.0 ? -e : e, d.z < 0.0 ? -e : e);
	vec3 dd = vec3(abs(d.x) < e ? s.x : d.x, abs(d.y) < e ? s.y : d.y, abs(d.z) < e ? s.z : d.z);
	return 1.0 / dd;
}

void intersectBVH(vec3 ro, vec3 rd, inout Hit hit) {
	if (uTriCount == 0) return;
	vec3 invD = safeInvDir(rd);
	int stack[32];
	int sp = 0;
	stack[sp++] = 0;
	for (int guard = 0; guard < 4096; guard++) {
		if (sp <= 0) break;
		int node = stack[--sp];
		vec4 a = fBVH(node * 2);
		vec4 b = fBVH(node * 2 + 1);
		if (!hitAABB(a.xyz, b.xyz, ro, invD, hit.t)) continue;
		int count = int(b.w + 0.5);
		if (count > 0) {
			int start = int(a.w + 0.5);
			for (int i = 0; i < count; i++) triIntersect(start + i, ro, rd, hit);
		} else if (sp <= 30) {
			int left = int(a.w + 0.5);
			stack[sp++] = left + 1;
			stack[sp++] = left;
		}
	}
}

void intersectGround(vec3 ro, vec3 rd, inout Hit hit) {
	if (uGroundOn == 0) return;
	if (abs(rd.y) < 1e-7) return;
	float t = (uGroundY - ro.y) / rd.y;
	if (t <= 1e-4 || t >= hit.t) return;
	vec3 p = ro + rd * t;
	if (uGroundRadius > 0.0 && dot(p.xz, p.xz) > uGroundRadius * uGroundRadius) return;
	hit.t = t; hit.tri = -2; hit.bc = vec2(0.0);
}

void intersectScene(vec3 ro, vec3 rd, inout Hit hit) {
	intersectGround(ro, rd, hit);
	intersectBVH(ro, rd, hit);
}

struct Surface {
	vec3 pos, ng, ns;
	vec2 uv;
	vec3 albedo;
	float alpha, rough, metal, transm, ior, cutoff;
	int amode;
	vec3 emission;
	bool isLight;
};

void triVerts(int i, out vec3 v0, out vec3 v1, out vec3 v2) {
	v0 = fTri(i * 3 + 0).xyz;
	v1 = fTri(i * 3 + 1).xyz;
	v2 = fTri(i * 3 + 2).xyz;
}

vec2 triUV(int i, vec2 bc) {
	vec4 a0 = fAttr(i * 4 + 0);
	vec4 a1 = fAttr(i * 4 + 1);
	vec4 a2 = fAttr(i * 4 + 2);
	vec4 a3 = fAttr(i * 4 + 3);
	vec2 uv0 = vec2(a0.w, a1.w);
	vec2 uv1 = vec2(a2.w, a3.x);
	vec2 uv2 = vec2(a3.y, a3.z);
	float w = 1.0 - bc.x - bc.y;
	return uv0 * w + uv1 * bc.x + uv2 * bc.y;
}

bool insideOnlyHitFromOutside(int i, vec2 bc, vec3 rd) {
	vec3 n0 = fAttr(i * 4 + 0).xyz;
	vec3 n1 = fAttr(i * 4 + 1).xyz;
	vec3 n2 = fAttr(i * 4 + 2).xyz;
	vec3 outward = normalize(n0 * (1.0 - bc.x - bc.y) + n1 * bc.x + n2 * bc.y);
	return dot(rd, outward) < 0.0;
}

Mat matOfTri(int i) {
	return loadMat(int(fTri(i * 3 + 0).w + 0.5));
}

float alphaOfTri(int i, vec2 bc, Mat m) {
	if ((m.flags & MF_HAS_COLOR) == 0) return 1.0;
	vec2 uv = triUV(i, bc);
	bool rep = (m.flags & MF_WRAP_REPEAT) != 0;
	return sampleAtlas(uAtlasC, m.rect, uv, rep).a;
}

bool alphaPassThrough(Mat m, float alpha) {
	if (m.amode == 0) return false;
	if (m.amode == 1) return alpha < m.cutoff;
	return rnd() >= alpha;
}

vec3 triEmission(int i, vec2 bc) {
	int matId = int(fTri(i * 3 + 0).w + 0.5);
	Mat m = loadMat(matId);
	vec2 uv = triUV(i, bc);
	bool rep = (m.flags & MF_WRAP_REPEAT) != 0;
	vec3 base = m.tint;
	if ((m.flags & MF_HAS_COLOR) != 0) base *= srgbToLin(sampleAtlas(uAtlasC, m.rect, uv, rep).rgb);
	if ((m.flags & MF_HAS_MER) != 0) {
		float e = sampleAtlas(uAtlasM, m.rect, uv, rep).g;
		return base * e * m.emis;
	}
	if ((m.flags & MF_HAS_EMISSIVE_MAP) != 0) {
		vec3 emsCol = srgbToLin(sampleAtlas(uAtlasE, m.rect, uv, rep).rgb);
		float mask = dot(emsCol, vec3(0.2126, 0.7152, 0.0722));
		if ((m.flags & MF_EMIS_CUSTOM_COLOR) != 0) return m.emisColor * mask * m.emis;
		if ((m.flags & MF_EMIS_MAIN_COLOR) != 0) return base * mask * m.emis;
		return emsCol * m.emis;
	}
	if ((m.flags & MF_FULLBRIGHT) != 0) return base * m.emis;
	return vec3(0.0);
}

void onb(vec3 n, out vec3 t, out vec3 b) {
	float s = n.z >= 0.0 ? 1.0 : -1.0;
	float a = -1.0 / (s + n.z);
	float bb = n.x * n.y * a;
	t = vec3(1.0 + s * n.x * n.x * a, s * bb, -s * n.x);
	b = vec3(bb, s + n.y * n.y * a, -n.y);
}

Surface getSurface(Hit hit, vec3 ro, vec3 rd) {
	Surface s;
	s.pos = ro + rd * hit.t;
	s.isLight = false;
	s.transm = 0.0;
	s.ior = 1.5;
	s.cutoff = 0.0;
	s.alpha = 1.0;
	s.amode = 0;
	s.emission = vec3(0.0);

	if (hit.tri == -2) {
		s.ng = vec3(0.0, 1.0, 0.0);
		s.ns = s.ng;
		s.uv = vec2(0.0);
		s.albedo = uGroundColor;
		s.rough = uGroundRough;
		s.metal = uGroundMetal;
		if (rd.y > 0.0) { s.ng = -s.ng; s.ns = -s.ns; }
		return s;
	}

	int i = hit.tri;
	vec3 v0, v1, v2;
	triVerts(i, v0, v1, v2);
	vec3 geoN = normalize(cross(v1 - v0, v2 - v0));

	vec4 a0 = fAttr(i * 4 + 0);
	vec4 a1 = fAttr(i * 4 + 1);
	vec4 a2 = fAttr(i * 4 + 2);
	vec4 a3 = fAttr(i * 4 + 3);
	float w = 1.0 - hit.bc.x - hit.bc.y;
	vec3 sn = a0.xyz * w + a1.xyz * hit.bc.x + a2.xyz * hit.bc.y;
	if (dot(sn, sn) < 1e-12) sn = geoN; else sn = normalize(sn);
	if (dot(sn, geoN) < 0.0) geoN = -geoN;

	vec2 uv0 = vec2(a0.w, a1.w);
	vec2 uv1 = vec2(a2.w, a3.x);
	vec2 uv2 = vec2(a3.y, a3.z);
	s.uv = uv0 * w + uv1 * hit.bc.x + uv2 * hit.bc.y;
	s.isLight = a3.w > 0.5;

	if (dot(geoN, rd) > 0.0) { geoN = -geoN; sn = -sn; }
	s.ng = geoN;
	s.ns = sn;

	int matId = int(fTri(i * 3 + 0).w + 0.5);
	Mat m = loadMat(matId);
	bool rep = (m.flags & MF_WRAP_REPEAT) != 0;

	vec3 base = m.tint;
	float alpha = 1.0;
	if ((m.flags & MF_HAS_COLOR) != 0) {
		vec4 c = sampleAtlas(uAtlasC, m.rect, s.uv, rep);
		base *= srgbToLin(c.rgb);
		alpha = c.a;
	}
	s.albedo = base;
	s.alpha = alpha;
	s.cutoff = m.cutoff;
	s.amode = m.amode;
	s.rough = clamp(m.rough, 0.015, 1.0);
	s.metal = clamp(m.metal, 0.0, 1.0);
	s.transm = clamp(m.transm, 0.0, 1.0);
	s.ior = max(m.ior, 1.001);

	if ((m.flags & MF_HAS_MER) != 0) {
		vec3 mer = sampleAtlas(uAtlasM, m.rect, s.uv, rep).rgb;
		s.metal = clamp(mer.r, 0.0, 1.0);
		s.rough = clamp(mer.b, 0.015, 1.0);
		s.emission = base * mer.g * m.emis;
	} else if ((m.flags & MF_HAS_EMISSIVE_MAP) != 0) {
		vec3 emsCol = srgbToLin(sampleAtlas(uAtlasE, m.rect, s.uv, rep).rgb);
		float mask = dot(emsCol, vec3(0.2126, 0.7152, 0.0722));
		if ((m.flags & MF_EMIS_CUSTOM_COLOR) != 0) {
			s.emission = m.emisColor * mask * m.emis;
		} else if ((m.flags & MF_EMIS_MAIN_COLOR) != 0) {
			s.emission = base * mask * m.emis;
		} else {
			s.emission = emsCol * m.emis;
		}
	} else if ((m.flags & MF_FULLBRIGHT) != 0) {
		s.emission = base * m.emis;
	}

	if ((m.flags & MF_HAS_NORMAL) != 0 && m.nscale > 0.0) {
		vec2 d1 = uv1 - uv0;
		vec2 d2 = uv2 - uv0;
		float r = d1.x * d2.y - d2.x * d1.y;
		if (abs(r) > 1e-9) {
			vec3 e1 = v1 - v0;
			vec3 e2 = v2 - v0;
			vec3 T = (e1 * d2.y - e2 * d1.y) / r;
			T = normalize(T - s.ns * dot(s.ns, T));
			if (dot(T, T) > 0.5) {
				vec3 B = cross(s.ns, T);
				vec3 nt = sampleAtlas(uAtlasN, m.rect, s.uv, rep).rgb * 2.0 - 1.0;
				nt.xy *= m.nscale;
				vec3 mapped = normalize(T * nt.x + B * nt.y + s.ns * max(nt.z, 0.05));
				if (dot(mapped, s.ng) > 0.0) s.ns = mapped;
			}
		}
	}
	return s;
}

vec2 dirToEnvUV(vec3 d) {
	float phi = atan(d.z, d.x) + uEnvRotation;
	float u = fract(phi * 0.15915494309189535 + 0.5);
	float v = acos(clamp(d.y, -1.0, 1.0)) * INV_PI;
	return vec2(u, clamp(v, 0.0, 1.0));
}

vec3 envRadiance(vec3 d) {
	return texture(uEnv, dirToEnvUV(d)).rgb * uEnvIntensity;
}

float envPdfDir(vec3 d) {
	int W = uEnvDist.x, H = uEnvDist.y;
	vec2 uv = dirToEnvUV(d);
	int x = clamp(int(uv.x * float(W)), 0, W - 1);
	int y = clamp(int(uv.y * float(H)), 0, H - 1);
	float pm = (texelFetch(uEnvMarg, ivec2(y + 1, 0), 0).r - texelFetch(uEnvMarg, ivec2(y, 0), 0).r) * float(H);
	float pc = (texelFetch(uEnvCond, ivec2(x + 1, y), 0).r - texelFetch(uEnvCond, ivec2(x, y), 0).r) * float(W);
	float sinT = sqrt(max(0.0, 1.0 - d.y * d.y));
	if (sinT < 1e-5) return 0.0;
	return (pm * pc) / (2.0 * PI * PI * sinT);
}

vec3 envSampleDir(out vec3 L, out float pdf) {
	int W = uEnvDist.x, H = uEnvDist.y;
	float r1 = rnd(), r2 = rnd();
	int lo = 0, hi = H;
	for (int i = 0; i < 12; i++) {
		if (lo + 1 >= hi) break;
		int mid = (lo + hi) >> 1;
		if (texelFetch(uEnvMarg, ivec2(mid, 0), 0).r <= r1) lo = mid; else hi = mid;
	}
	int y = lo;
	float m0 = texelFetch(uEnvMarg, ivec2(y, 0), 0).r;
	float m1 = texelFetch(uEnvMarg, ivec2(y + 1, 0), 0).r;
	float dy = (m1 > m0) ? (r1 - m0) / (m1 - m0) : 0.5;

	lo = 0; hi = W;
	for (int i = 0; i < 12; i++) {
		if (lo + 1 >= hi) break;
		int mid = (lo + hi) >> 1;
		if (texelFetch(uEnvCond, ivec2(mid, y), 0).r <= r2) lo = mid; else hi = mid;
	}
	int x = lo;
	float c0 = texelFetch(uEnvCond, ivec2(x, y), 0).r;
	float c1 = texelFetch(uEnvCond, ivec2(x + 1, y), 0).r;
	float dx = (c1 > c0) ? (r2 - c0) / (c1 - c0) : 0.5;

	float u = (float(x) + dx) / float(W);
	float v = (float(y) + dy) / float(H);
	float theta = v * PI;
	float phi = (u - 0.5) * 2.0 * PI - uEnvRotation;
	float sinT = sin(theta);
	L = vec3(sinT * cos(phi), cos(theta), sinT * sin(phi));
	float pm = (m1 - m0) * float(H);
	float pc = (c1 - c0) * float(W);
	pdf = (sinT > 1e-5) ? (pm * pc) / (2.0 * PI * PI * sinT) : 0.0;
	return envRadiance(L);
}

vec3 sunRadianceFor(vec3 d) {
	if (uSunEnable == 0) return vec3(0.0);
	return dot(d, uSunDir) >= uSunCosRadius ? uSunRadiance : vec3(0.0);
}
float sunPdfFor(vec3 d) {
	if (uSunEnable == 0) return 0.0;
	return dot(d, uSunDir) >= uSunCosRadius ? (1.0 / uSunSolidAngle) : 0.0;
}
vec3 sunSampleDir(out float pdf) {
	float cosT = mix(uSunCosRadius, 1.0, rnd());
	float sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
	float phi = 2.0 * PI * rnd();
	vec3 t, b;
	onb(uSunDir, t, b);
	pdf = 1.0 / uSunSolidAngle;
	return normalize(t * (sinT * cos(phi)) + b * (sinT * sin(phi)) + uSunDir * cosT);
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float powerHeuristic(float a, float b) {
	float aa = a * a, bb = b * b;
	return aa / max(aa + bb, 1e-9);
}
float specProb(vec3 albedo, float metal) {
	float ds = luma(albedo) * (1.0 - metal);
	float ss = luma(mix(vec3(0.04), albedo, metal)) + metal * 0.5;
	return clamp(ss / max(ds + ss, 1e-4), 0.12, 0.9);
}
float distGGX(float NoH, float a) {
	float a2 = a * a;
	float d = NoH * NoH * (a2 - 1.0) + 1.0;
	return a2 / max(PI * d * d, 1e-9);
}
float smithG(float NoV, float NoL, float a) {
	float a2 = a * a;
	float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
	float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
	return 0.5 / max(gv + gl, 1e-9);
}

vec3 bsdfEval(vec3 N, vec3 V, vec3 L, vec3 albedo, float rough, float metal, out float pdf) {
	pdf = 0.0;
	float NoL = dot(N, L);
	float NoV = dot(N, V);
	if (NoL <= 0.0 || NoV <= 0.0) return vec3(0.0);
	vec3 H = normalize(V + L);
	float NoH = max(dot(N, H), 0.0);
	float VoH = max(dot(V, H), 1e-5);
	float a = max(rough * rough, 1e-4);
	vec3 f0 = mix(vec3(0.04), albedo, metal);
	vec3 F = f0 + (1.0 - f0) * pow(clamp(1.0 - VoH, 0.0, 1.0), 5.0);
	float D = distGGX(NoH, a);
	float Vis = smithG(NoV, NoL, a);
	vec3 spec = F * D * Vis;
	vec3 diff = albedo * (1.0 - metal) * INV_PI;
	float ps = specProb(albedo, metal);
	float pdfS = D * NoH / (4.0 * VoH);
	float pdfD = NoL * INV_PI;
	pdf = mix(pdfD, pdfS, ps);
	return (diff + spec) * NoL;
}

vec3 cosineSample(vec3 n, vec2 u) {
	float r = sqrt(u.x);
	float phi = 2.0 * PI * u.y;
	vec3 t, b;
	onb(n, t, b);
	return normalize(t * (r * cos(phi)) + b * (r * sin(phi)) + n * sqrt(max(0.0, 1.0 - u.x)));
}

vec3 ggxSampleH(vec3 n, float a, vec2 u) {
	float phi = 2.0 * PI * u.x;
	float cosT = sqrt(max(0.0, (1.0 - u.y) / (1.0 + (a * a - 1.0) * u.y)));
	float sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
	vec3 t, b;
	onb(n, t, b);
	return normalize(t * (sinT * cos(phi)) + b * (sinT * sin(phi)) + n * cosT);
}

bool bsdfSample(vec3 N, vec3 V, vec3 albedo, float rough, float metal, out vec3 L, out vec3 weight, out float pdf) {
	float ps = specProb(albedo, metal);
	float a = max(rough * rough, 1e-4);
	if (rnd() < ps) {
		vec3 H = ggxSampleH(N, a, rnd2());
		L = reflect(-V, H);
	} else {
		L = cosineSample(N, rnd2());
	}
	if (dot(N, L) <= 0.0) return false;
	vec3 f = bsdfEval(N, V, L, albedo, rough, metal, pdf);
	if (pdf <= 1e-8) return false;
	weight = f / pdf;
	return true;
}

float fresnelDielectric(float cosI, float eta) {
	float s2 = eta * eta * (1.0 - cosI * cosI);
	if (s2 > 1.0) return 1.0;
	float cosT = sqrt(max(0.0, 1.0 - s2));
	float rs = (eta * cosI - cosT) / (eta * cosI + cosT);
	float rp = (cosI - eta * cosT) / (cosI + eta * cosT);
	return 0.5 * (rs * rs + rp * rp);
}

bool anyHitBVH(vec3 ro, vec3 rd, float maxT) {
	if (uTriCount == 0) return false;
	vec3 invD = safeInvDir(rd);
	int stack[32];
	int sp = 0;
	stack[sp++] = 0;
	for (int guard = 0; guard < 4096; guard++) {
		if (sp <= 0) break;
		int node = stack[--sp];
		vec4 a = fBVH(node * 2);
		vec4 b = fBVH(node * 2 + 1);
		if (!hitAABB(a.xyz, b.xyz, ro, invD, maxT)) continue;
		int count = int(b.w + 0.5);
		if (count > 0) {
			int start = int(a.w + 0.5);
			for (int i = 0; i < count; i++) {
				Hit h;
				h.t = maxT;
				h.tri = -1;
				h.bc = vec2(0.0);
				triIntersect(start + i, ro, rd, h);
				if (h.tri >= 0) {
					if (isNegativeCubeTri(h.tri)) continue;
					Mat hm = matOfTri(h.tri);
					if (hm.amode == 0 || !alphaPassThrough(hm, alphaOfTri(h.tri, h.bc, hm))) return true;
				}
			}
		} else if (sp <= 30) {
			int left = int(a.w + 0.5);
			stack[sp++] = left + 1;
			stack[sp++] = left;
		}
	}
	return false;
}

bool occluded(vec3 ro, vec3 rd, float maxT, bool skipGround) {
	if (!skipGround && uGroundOn == 1) {
		Hit gh;
		gh.t = maxT;
		gh.tri = -1;
		gh.bc = vec2(0.0);
		intersectGround(ro, rd, gh);
		if (gh.tri == -2) return true;
	}
	return anyHitBVH(ro, rd, maxT);
}

struct LightSample { vec3 dir; vec3 radiance; float pdf; float dist; };

LightSample sampleTriLight(vec3 p) {
	LightSample ls;
	ls.dir = vec3(0.0, 1.0, 0.0);
	ls.radiance = vec3(0.0);
	ls.pdf = 0.0;
	ls.dist = 0.0;
	if (uLightCount == 0) return ls;

	int li = min(int(rnd() * float(uLightCount)), uLightCount - 1);
	int tri = int(texelFetch(uLightTex, ivec2(li - (li / uLightW) * uLightW, li / uLightW), 0).r + 0.5);
	vec3 v0, v1, v2;
	triVerts(tri, v0, v1, v2);
	float su = sqrt(rnd());
	float b0 = 1.0 - su;
	float b1 = rnd() * su;
	float b2 = max(0.0, 1.0 - b0 - b1);
	vec3 q = v0 * b0 + v1 * b1 + v2 * b2;
	vec3 cr = cross(v1 - v0, v2 - v0);
	float area2 = length(cr);
	if (area2 < 1e-9) return ls;
	vec3 nl = cr / area2;
	float area = 0.5 * area2;

	vec3 dv = q - p;
	float d2 = dot(dv, dv);
	if (d2 < 1e-8) return ls;
	float d = sqrt(d2);
	ls.dir = dv / d;
	ls.dist = d;
	float cosL = abs(dot(nl, ls.dir));
	if (cosL < 1e-5) return ls;
	ls.pdf = d2 / (cosL * area * float(uLightCount));
	ls.radiance = triEmission(tri, vec2(b1, b2));
	return ls;
}

float triLightPdf(int tri, vec3 from, vec3 hitP) {
	if (uLightCount == 0) return 0.0;
	vec3 v0, v1, v2;
	triVerts(tri, v0, v1, v2);
	vec3 cr = cross(v1 - v0, v2 - v0);
	float area2 = length(cr);
	if (area2 < 1e-9) return 0.0;
	vec3 nl = cr / area2;
	vec3 dv = hitP - from;
	float d2 = dot(dv, dv);
	float d = sqrt(max(d2, 1e-12));
	float cosL = abs(dot(nl, dv / d));
	if (cosL < 1e-5) return 0.0;
	return d2 / (cosL * 0.5 * area2 * float(uLightCount));
}

float shadowCatcherAlpha(vec3 p, vec3 n) {
	float full = 0.0, vis = 0.0;
	if (uSunEnable == 1) {
		float pdf;
		vec3 L = sunSampleDir(pdf);
		float ndl = max(dot(n, L), 0.0);
		if (ndl > 0.0 && pdf > 0.0) {
			float c = luma(uSunRadiance) * ndl / pdf;
			full += c;
			if (!occluded(p + n * RAY_EPS, L, TFAR, true)) vis += c;
		}
	}
	{
		vec3 L;
		float pdf;
		vec3 Le = envSampleDir(L, pdf);
		float ndl = max(dot(n, L), 0.0);
		if (ndl > 0.0 && pdf > 1e-8) {
			float c = luma(Le) * ndl / pdf;
			full += c;
			if (!occluded(p + n * RAY_EPS, L, TFAR, true)) vis += c;
		}
	}
	if (full <= 1e-8) return 0.0;
	return clamp(1.0 - vis / full, 0.0, 1.0);
}

vec3 tracePath(vec3 ro, vec3 rd, out float alphaOut, out vec3 gAlbedo, out vec3 gNormal, out float gDepth) {
	vec3 radiance = vec3(0.0);
	vec3 beta = vec3(1.0);
	float lastPdf = 0.0;
	bool specularPath = true;
	alphaOut = 1.0;
	gAlbedo = vec3(0.0);
	gNormal = vec3(0.0);
	gDepth = 1.0e6;
	bool gWritten = false;
	int bounce = 0;
	vec3 prevPos = ro;

	for (int iter = 0; iter < 96; iter++) {
		Hit hit;
		hit.t = TFAR;
		hit.tri = -1;
		hit.bc = vec2(0.0);
		intersectScene(ro, rd, hit);
		if (hit.tri >= 0 && isNegativeCubeTri(hit.tri)) {
			if (bounce > 0 || (isInsideOnlyTri(hit.tri) && insideOnlyHitFromOutside(hit.tri, hit.bc, rd))) {
				ro += rd * (hit.t + RAY_EPS);
				continue;
			}
		}

		if (hit.tri == -1) {
			vec3 env = envRadiance(rd);
			vec3 sun = sunRadianceFor(rd);
			if (bounce == 0) {
				if (uBgMode == 1) { radiance += uBgColor; gAlbedo = uBgColor; }
				else if (uBgMode == 2) { alphaOut = 0.0; gAlbedo = vec3(0.0); }
				else { radiance += env + sun; gAlbedo = env; }
				gNormal = -rd;
			} else {
				float we = specularPath ? 1.0 : powerHeuristic(lastPdf, envPdfDir(rd));
				float ws = specularPath ? 1.0 : powerHeuristic(lastPdf, sunPdfFor(rd));
				radiance += beta * (env * we + sun * ws);
			}
			break;
		}

		Surface s = getSurface(hit, ro, rd);

		bool passThrough = false;
		if (s.amode == 1) passThrough = s.alpha < s.cutoff;
		else if (s.amode == 2) passThrough = rnd() >= s.alpha;
		if (passThrough) {
			ro = s.pos + rd * RAY_EPS;
			continue;
		}

		if (bounce == 0 && hit.tri == -2 && uGroundCatcher == 1) {
			alphaOut = shadowCatcherAlpha(s.pos, s.ng);
			gAlbedo = vec3(0.0);
			gNormal = s.ng;
			gDepth = hit.t;
			break;
		}

		if (!gWritten) {
			gAlbedo = s.albedo;
			gNormal = s.ns;
			gDepth = hit.t;
			gWritten = true;
		}

		if (dot(s.emission, s.emission) > 0.0) {
			float w = 1.0;
			if (!specularPath && s.isLight) {
				w = powerHeuristic(lastPdf, triLightPdf(hit.tri, prevPos, s.pos));
			}
			radiance += beta * s.emission * w;
		}

		if (bounce >= uMaxBounce) break;

		vec3 V = -rd;

		if (s.transm > 0.0 && rnd() < s.transm) {
			bool entering = dot(rd, s.ng) < 0.0;
			vec3 n = s.ng;
			float eta = entering ? (1.0 / s.ior) : s.ior;
			float cosI = clamp(dot(-rd, n), 0.0, 1.0);
			float F = fresnelDielectric(cosI, eta);
			vec3 newDir;
			if (rnd() < F) {
				newDir = reflect(rd, n);
			} else {
				newDir = refract(rd, n, eta);
				if (dot(newDir, newDir) < 1e-8) newDir = reflect(rd, n);
				else beta *= s.albedo;
			}
			ro = s.pos + newDir * RAY_EPS;
			rd = normalize(newDir);
			specularPath = true;
			bounce++;
			continue;
		}

		vec3 shadeOrigin = s.pos + s.ng * RAY_EPS;

		int nLS = max(uLightSamples, 1);
		float invLS = 1.0 / float(nLS);
		for (int ls_i = 0; ls_i < nLS; ls_i++) {
			vec3 L;
			float pdfL;
			vec3 Le = envSampleDir(L, pdfL);
			if (pdfL > 1e-8 && dot(L, s.ns) > 0.0 && dot(L, s.ng) > 0.0 && dot(Le, Le) > 0.0) {
				float pdfB;
				vec3 f = bsdfEval(s.ns, V, L, s.albedo, s.rough, s.metal, pdfB);
				if (dot(f, f) > 0.0 && !occluded(shadeOrigin, L, TFAR, false)) {
					radiance += beta * f * Le * powerHeuristic(pdfL, pdfB) / pdfL * invLS;
				}
			}
		}

		if (uSunEnable == 1) {
			for (int ls_i = 0; ls_i < nLS; ls_i++) {
				float pdfL;
				vec3 L = sunSampleDir(pdfL);
				if (pdfL > 0.0 && dot(L, s.ns) > 0.0 && dot(L, s.ng) > 0.0) {
					float pdfB;
					vec3 f = bsdfEval(s.ns, V, L, s.albedo, s.rough, s.metal, pdfB);
					if (dot(f, f) > 0.0 && !occluded(shadeOrigin, L, TFAR, false)) {
						radiance += beta * f * uSunRadiance * powerHeuristic(pdfL, pdfB) / pdfL * invLS;
					}
				}
			}
		}

		if (uLightCount > 0) {
			for (int ls_i = 0; ls_i < nLS; ls_i++) {
				LightSample ls = sampleTriLight(s.pos);
				if (ls.pdf > 1e-8 && dot(ls.dir, s.ns) > 0.0 && dot(ls.dir, s.ng) > 0.0 && dot(ls.radiance, ls.radiance) > 0.0) {
					float pdfB;
					vec3 f = bsdfEval(s.ns, V, ls.dir, s.albedo, s.rough, s.metal, pdfB);
					if (dot(f, f) > 0.0 && !occluded(shadeOrigin, ls.dir, ls.dist - RAY_EPS * 2.0, false)) {
						radiance += beta * f * ls.radiance * powerHeuristic(ls.pdf, pdfB) / ls.pdf * invLS;
					}
				}
			}
		}

		vec3 L, weight;
		float pdfB;
		if (!bsdfSample(s.ns, V, s.albedo, s.rough, s.metal, L, weight, pdfB)) break;
		if (dot(L, s.ng) <= 0.0) break;

		beta *= weight;
		lastPdf = pdfB;
		specularPath = false;
		prevPos = s.pos;
		ro = shadeOrigin;
		rd = L;
		bounce++;

		if (bounce > 2) {
			float q = clamp(max(beta.r, max(beta.g, beta.b)), 0.02, 0.95);
			if (rnd() > q) break;
			beta /= q;
		}
		if (dot(beta, beta) < 1e-12) break;
	}

	if (uClamp > 0.0) {
		float m = max(radiance.r, max(radiance.g, radiance.b));
		if (m > uClamp) radiance *= uClamp / m;
	}
	if (any(isnan(radiance)) || any(isinf(radiance))) radiance = vec3(0.0);
	return radiance;
}

void main() {
	ivec2 px = ivec2(gl_FragCoord.xy);
	g_rng = uint(px.x) * 1973u + uint(px.y) * 9277u + uint(uSeed) * 26699u;
	g_rng = g_rng | 1u;
	pcgNext();
	pcgNext();

	vec2 jitter = rnd2();
	vec2 ndc = ((gl_FragCoord.xy - 0.5 + jitter) / uResolution) * 2.0 - 1.0;

	vec3 ro, rd;
	if (uOrtho == 1) {
		ro = uCamPos + uCamRight * (ndc.x * uOrthoHalfHeight * uAspect) + uCamUp * (ndc.y * uOrthoHalfHeight);
		rd = normalize(uCamForward);
	} else {
		rd = normalize(uCamForward + uCamRight * (ndc.x * uTanHalfFov * uAspect) + uCamUp * (ndc.y * uTanHalfFov));
		ro = uCamPos;
		if (uAperture > 0.0 && uFocusDist > 0.0) {
			vec3 focal = ro + rd * (uFocusDist / max(dot(rd, normalize(uCamForward)), 1e-4));
			float ang = 2.0 * PI * rnd();
			float rad = uAperture * sqrt(rnd());
			ro += uCamRight * (cos(ang) * rad) + uCamUp * (sin(ang) * rad);
			rd = normalize(focal - ro);
		}
	}

	float alpha, depth;
	vec3 alb, nrm;
	vec3 c = tracePath(ro, rd, alpha, alb, nrm, depth);
#ifndef PTR_COLOR_ONLY
	vec3 demod = c / max(alb, vec3(0.02));
	float l = dot(demod, vec3(0.2126, 0.7152, 0.0722));
#endif

	vec4 prev = vec4(0.0);
#ifndef PTR_COLOR_ONLY
	vec4 prevA = vec4(0.0);
	vec4 prevN = vec4(0.0);
	vec4 prevM = vec4(0.0);
#endif
	if (uReset == 0) {
		prev = texelFetch(uAccum, px, 0);
#ifndef PTR_COLOR_ONLY
		prevA = texelFetch(uAccumAlb, px, 0);
		prevN = texelFetch(uAccumNrm, px, 0);
		prevM = texelFetch(uAccumMom, px, 0);
#endif
	}
	outColor = prev + vec4(c, alpha);
#ifndef PTR_COLOR_ONLY
	outAlbedo = prevA + vec4(alb, 1.0);
	outNormal = prevN + vec4(nrm, 1.0);
	outMoment = prevM + vec4(l, l * l, depth, 1.0);
#endif
}
`;

	const FS_PATHTRACE_COLOR_ONLY = FS_PATHTRACE.replace(
		'#version 300 es\n', '#version 300 es\n#define PTR_COLOR_ONLY 1\n'
	);

	const FS_DENOISE = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uColorIn;
uniform sampler2D uAlbedoTex;
uniform sampler2D uNormalTex;
uniform sampler2D uMomentTex;
uniform sampler2D uVarianceIn;
uniform int   uFirst;
uniform float uInvSpp;
uniform int   uStepSize;
uniform float uPhiColorBase;
uniform float uPhiNormal;
uniform float uPhiDepth;

layout(location = 0) out vec4 fragColor;
layout(location = 1) out float outVariance;

vec3 loadColor(ivec2 p, ivec2 size) {
	p = clamp(p, ivec2(0), size - 1);
	if (uFirst == 1) {
		vec3 c = texelFetch(uColorIn, p, 0).rgb * uInvSpp;
		vec3 a = max(texelFetch(uAlbedoTex, p, 0).rgb * uInvSpp, vec3(0.02));
		return c / a;
	}
	return texelFetch(uColorIn, p, 0).rgb;
}

float loadVariance(ivec2 p, ivec2 size) {
	p = clamp(p, ivec2(0), size - 1);
	if (uFirst == 1) {
		vec4 m = texelFetch(uMomentTex, p, 0) * uInvSpp;
		float perSample = max(m.y - m.x * m.x, 0.0);
		return perSample * uInvSpp;
	}
	return texelFetch(uVarianceIn, p, 0).r;
}

float loadDepth(ivec2 p, ivec2 size) {
	p = clamp(p, ivec2(0), size - 1);
	vec4 m = texelFetch(uMomentTex, p, 0);
	return m.w > 0.0 ? m.z / m.w : 1.0e6;
}

float kern(int d) {
	int i = d < 0 ? -d : d;
	if (i == 2) return 0.0625;
	if (i == 1) return 0.25;
	return 0.375;
}

void main() {
	ivec2 size = textureSize(uColorIn, 0);
	ivec2 px = ivec2(gl_FragCoord.xy);

	vec3 cp = loadColor(px, size);
	float varP = loadVariance(px, size);
	float depthP = loadDepth(px, size);
	vec3 np = texelFetch(uNormalTex, px, 0).xyz;
	float nl = length(np);
	np = nl > 1e-6 ? np / nl : vec3(0.0, 1.0, 0.0);

	float phiColor = uPhiColorBase * sqrt(max(varP, 0.0)) + 1e-4;

	vec3 sum = vec3(0.0);
	float wsum = 0.0;
	float varSum = 0.0;
	float varWsum = 0.0;
	for (int dy = -2; dy <= 2; dy++) {
		for (int dx = -2; dx <= 2; dx++) {
			ivec2 q = px + ivec2(dx, dy) * uStepSize;
			if (q.x < 0 || q.y < 0 || q.x >= size.x || q.y >= size.y) continue;
			vec3 cq = loadColor(q, size);
			float varQ = loadVariance(q, size);
			float depthQ = loadDepth(q, size);
			vec3 nq = texelFetch(uNormalTex, q, 0).xyz;
			float ql = length(nq);
			nq = ql > 1e-6 ? nq / ql : vec3(0.0, 1.0, 0.0);

			vec3 dc = cp - cq;
			float wc = exp(-dot(dc, dc) / (phiColor * phiColor));
			float nd = max(0.0, 1.0 - dot(np, nq));
			float wn = exp(-nd * nd / max(uPhiNormal, 1e-5));
			float dd = abs(depthP - depthQ);
			float wd = (depthP > 1.0e5 || depthQ > 1.0e5) ? (dd < 1.0 ? 1.0 : 0.0)
				: exp(-dd * dd / max(uPhiDepth * depthP * depthP + 1e-6, 1e-6));
			float w = kern(dx) * kern(dy) * wc * wn * wd;
			sum += cq * w;
			wsum += w;
			varSum += varQ * w * w;
			varWsum += w;
		}
	}
	fragColor = vec4(wsum > 1e-8 ? sum / wsum : cp, 1.0);
	outVariance = varWsum > 1e-8 ? varSum / (varWsum * varWsum) : varP;
}
`;

	const FS_COMPOSITE = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uAccumTex;
uniform sampler2D uDenoisedTex;
uniform sampler2D uAlbedoTex;
uniform float uInvSpp;
uniform int   uUseDenoise;
uniform float uExposure;

out vec4 fragColor;

void main() {
	ivec2 px = ivec2(gl_FragCoord.xy);
	vec4 acc = texelFetch(uAccumTex, px, 0);
	vec3 color;
	if (uUseDenoise == 1) {
		vec3 alb = max(texelFetch(uAlbedoTex, px, 0).rgb * uInvSpp, vec3(0.02));
		color = texelFetch(uDenoisedTex, px, 0).rgb * alb;
	} else {
		color = acc.rgb * uInvSpp;
	}
	float alpha = clamp(acc.a * uInvSpp, 0.0, 1.0);
	color = max(color, vec3(0.0)) * uExposure;
	fragColor = vec4(color, alpha);
}
`;

	const FS_BLOOM_BRIGHT = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uHDR;
uniform float uThreshold;

out vec4 fragColor;

void main() {
	ivec2 px = ivec2(gl_FragCoord.xy);
	vec3 c = texelFetch(uHDR, px, 0).rgb;
	fragColor = vec4(max(c - vec3(uThreshold), 0.0), 1.0);
}
`;

	const FS_BLOOM_BLUR = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uTex;
uniform vec2 uDir;
uniform float uRadius;

out vec4 fragColor;

void main() {
	ivec2 px = ivec2(gl_FragCoord.xy);
	ivec2 size = textureSize(uTex, 0);
	float sigma = max(uRadius, 0.5);
	float step = max(sigma / 4.0, 1.0);
	vec3 sum = vec3(0.0);
	float wsum = 0.0;
	for (int i = -8; i <= 8; i++) {
		float fi = float(i);
		float w = exp(-(fi * fi) / (2.0 * sigma * sigma));
		ivec2 q = px + ivec2(uDir * fi * step);
		q = clamp(q, ivec2(0), size - 1);
		sum += texelFetch(uTex, q, 0).rgb * w;
		wsum += w;
	}
	fragColor = vec4(wsum > 1e-6 ? sum / wsum : vec3(0.0), 1.0);
}
`;

	const FS_TONEMAP = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uHDR;
uniform sampler2D uBloomTex;
uniform int   uUseBloom;
uniform float uBloomIntensity;
uniform float uContrast;
uniform float uSaturation;
uniform int   uToneMap;
uniform int   uVignetteEnable;
uniform float uVignetteStrength;
uniform vec2  uResolution;

out vec4 fragColor;

vec3 tmReinhard(vec3 c) { return c / (1.0 + c); }

vec3 tmACES(vec3 x) {
	const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
	return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 uncharted2(vec3 x) {
	const float A = 0.15, B = 0.50, C = 0.10, D = 0.20, E = 0.02, F = 0.30;
	return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
}
vec3 tmFilmic(vec3 c) {
	vec3 w = uncharted2(vec3(11.2));
	return clamp(uncharted2(c * 2.0) / w, 0.0, 1.0);
}

vec3 tmAgX(vec3 c) {
	c = max(c, vec3(0.0));
	const mat3 inSet = mat3(
		0.842479062253094, 0.0423282422610123, 0.0423756549057051,
		0.0784335999999992, 0.878468636469772, 0.0784336000000000,
		0.0792237451477643, 0.0791661274605434, 0.879142973793104);
	const mat3 outSet = mat3(
		1.19687900512017, -0.0528968517574562, -0.0529716355144438,
		-0.0980208811401368, 1.15190312990417, -0.0980434501171241,
		-0.0990297440797205, -0.0989611768448433, 1.15107367264116);
	c = inSet * c;
	c = clamp((log2(max(c, vec3(1e-10))) + 12.47393) / (12.47393 + 4.026069), 0.0, 1.0);
	vec3 x = c;
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	c = 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
	c = outSet * c;
	return clamp(c, 0.0, 1.0);
}

vec3 linearToSRGB(vec3 c) {
	c = clamp(c, 0.0, 1.0);
	return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

void main() {
	ivec2 px = ivec2(gl_FragCoord.xy);
	vec4 hdr = texelFetch(uHDR, px, 0);
	vec3 color = hdr.rgb;
	if (uUseBloom == 1) color += texelFetch(uBloomTex, px, 0).rgb * uBloomIntensity;

	if (uToneMap == 1) color = tmReinhard(color);
	else if (uToneMap == 2) color = tmACES(color);
	else if (uToneMap == 3) color = tmFilmic(color);
	else if (uToneMap == 4) color = tmAgX(color);
	else color = clamp(color, 0.0, 1.0);

	float l = dot(color, vec3(0.2126, 0.7152, 0.0722));
	color = mix(vec3(l), color, uSaturation);
	color = clamp((color - 0.5) * uContrast + 0.5, 0.0, 1.0);

	if (uVignetteEnable == 1) {
		vec2 uv = (gl_FragCoord.xy / uResolution) * 2.0 - 1.0;
		float d = clamp(dot(uv, uv) * 0.5, 0.0, 1.0);
		color *= clamp(1.0 - uVignetteStrength * d, 0.0, 1.0);
	}

	fragColor = vec4(linearToSRGB(color), hdr.a);
}
`;

	const FS_FINAL = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uTex;
uniform int   uSharpenEnable;
uniform float uSharpenStrength;
uniform int   uGrainEnable;
uniform float uGrainStrength;
uniform float uGrainSeed;

out vec4 fragColor;

float hash(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

void main() {
	ivec2 px = ivec2(gl_FragCoord.xy);
	vec4 c = texelFetch(uTex, px, 0);
	vec3 color = c.rgb;

	if (uSharpenEnable == 1) {
		vec3 n = texelFetch(uTex, px + ivec2(0, 1), 0).rgb
			+ texelFetch(uTex, px + ivec2(0, -1), 0).rgb
			+ texelFetch(uTex, px + ivec2(1, 0), 0).rgb
			+ texelFetch(uTex, px + ivec2(-1, 0), 0).rgb;
		vec3 lap = color * 4.0 - n;
		color = clamp(color + uSharpenStrength * lap, 0.0, 1.0);
	}

	if (uGrainEnable == 1) {
		float n = hash(gl_FragCoord.xy + uGrainSeed) - 0.5;
		color = clamp(color + n * uGrainStrength, 0.0, 1.0);
	}

	fragColor = vec4(color, c.a);
}
`;

