--
-- PostgreSQL database dump
--

-- Dumped from database version 13.20
-- Dumped by pg_dump version 13.20

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER TABLE IF EXISTS ONLY public.receta_articulos DROP CONSTRAINT IF EXISTS receta_articulos_receta_id_fkey;
ALTER TABLE IF EXISTS ONLY public.bunker_articulos DROP CONSTRAINT IF EXISTS bunker_articulos_familia_id_fkey;
DROP INDEX IF EXISTS public.idx_bunker_articulos_familia_id;
ALTER TABLE IF EXISTS ONLY public.recetas DROP CONSTRAINT IF EXISTS recetas_pkey;
ALTER TABLE IF EXISTS ONLY public.recetas DROP CONSTRAINT IF EXISTS recetas_articulo_numero_key;
ALTER TABLE IF EXISTS ONLY public.receta_articulos DROP CONSTRAINT IF EXISTS receta_articulos_pkey;
ALTER TABLE IF EXISTS ONLY public.bunker_articulos DROP CONSTRAINT IF EXISTS bunker_articulos_pkey;
ALTER TABLE IF EXISTS public.recetas ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.receta_articulos ALTER COLUMN id DROP DEFAULT;
DROP SEQUENCE IF EXISTS public.recetas_id_seq;
DROP TABLE IF EXISTS public.recetas;
DROP SEQUENCE IF EXISTS public.receta_articulos_id_seq;
DROP TABLE IF EXISTS public.receta_articulos;
DROP TABLE IF EXISTS public.bunker_articulos;
DROP TABLE IF EXISTS public.articulos;
SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: articulos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.articulos (
    numero text,
    nombre text,
    codigo_barras text,
    stock_ventas numeric
);


ALTER TABLE public.articulos OWNER TO postgres;

--
-- Name: bunker_articulos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bunker_articulos (
    articulo_id character varying(30) NOT NULL,
    costo_base numeric(14,2) DEFAULT 0.00,
    porcentaje_iva numeric(5,2) DEFAULT 21.00,
    moneda character varying(50) DEFAULT '($)Pesos'::character varying,
    redondeo character varying(30) DEFAULT 'Ninguno'::character varying,
    mantener_utilidad boolean DEFAULT false,
    rubro text,
    sub_rubro text,
    no_producido_por_lambda boolean DEFAULT false,
    kilos_unidad numeric(10,2),
    es_pack boolean DEFAULT false,
    pack_hijo_codigo text,
    propiedades_dinamicas jsonb DEFAULT '{}'::jsonb,
    descripcion character varying(255),
    descripcion_generada character varying(255),
    expresado_en_gramos boolean DEFAULT false,
    expresado_en_unidades boolean DEFAULT false,
    pack_unidades integer DEFAULT 1,
    familia_id integer
);


ALTER TABLE public.bunker_articulos OWNER TO postgres;

--
-- Name: receta_articulos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.receta_articulos (
    id integer NOT NULL,
    receta_id integer NOT NULL,
    articulo_numero text NOT NULL,
    cantidad numeric(10,2) DEFAULT 1 NOT NULL
);


ALTER TABLE public.receta_articulos OWNER TO postgres;

--
-- Name: receta_articulos_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.receta_articulos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.receta_articulos_id_seq OWNER TO postgres;

--
-- Name: receta_articulos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.receta_articulos_id_seq OWNED BY public.receta_articulos.id;


--
-- Name: recetas; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.recetas (
    id integer NOT NULL,
    articulo_numero text NOT NULL,
    descripcion text,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    articulo_sugerido_numero text,
    enlazado_externo boolean DEFAULT false
);


ALTER TABLE public.recetas OWNER TO postgres;

--
-- Name: recetas_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.recetas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.recetas_id_seq OWNER TO postgres;

--
-- Name: recetas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.recetas_id_seq OWNED BY public.recetas.id;


--
-- Name: receta_articulos id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.receta_articulos ALTER COLUMN id SET DEFAULT nextval('public.receta_articulos_id_seq'::regclass);


--
-- Name: recetas id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recetas ALTER COLUMN id SET DEFAULT nextval('public.recetas_id_seq'::regclass);


--
-- Data for Name: articulos; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.articulos (numero, nombre, codigo_barras, stock_ventas) FROM stdin;
ACX18	Aceit/Coco x 18	9877455548	3
EMB-X8SLNC	Nuez/cu/light x 12	3837483164	0
EMB-2WG4XI	Bolsas Barritas (96)	9123558074	0
EMB-MN4UM1	Cast/Caju/W5 x 22,68	1399836559	0
EMB-7XKJBT	Caja micro x 4 unidades	1772565231	0
EMB-8RO0YE	Mix/Semillas x 1	9519088433	0
ACN1X660	Aceit/Coco/Neutro 1 x 660 cc	5463259865	0
ACNIDC12X500	Aceit/Coco/Neutro 12 x 500	806809018891	0
ADVx4A	Aceit/Desc/Ver x 4 A	2522526481	1
AN00x5	Aceit/Neg 00 bid x 5	2522526473	2
ANDX5	Aceit/Neg/Desc x 4	8733264551	0
ANRX4	Aceit/Neg/Rodaja x 4	2522526437	-3
AO12x1P	Aceit/Oliva Caja 12 x 1 Pasrai	4638287177	0
AO12x250P	Aceit/Oliva Caja 12 x 250 Pasrai	4638287175	0
AO12x500P	Aceit/Oliva Caja 12 x 500 Pasrai	4638287176	0
AO8x1P	Aceit/Oliva Caja 8 x 1 Pasrai	4638287178	1
AOX3	Aceit/Oliva x 3	7798119510086	0
AOx1	Aceit/Oliva x litro (Pet)	7798119510093	8
AV00x5	Aceit/Ver/00 x 5	2522526475	1
EMB-67EZ0G	Aceite de Coco Neutro 1 x 4 Litros	9589768550	0
AMx1	Aji Molido x 1 kg.	7791885409257	2
AJPX1	Ajo/Polvo x 1	3233147855	0
AJPX25	Ajo/Polvo x 25	3233147854	1
AGSX100L	Algas/NORI x 100 L.	6927028311991	9
APTPGUP	Almen/Pel/Tos (Unidad Productiva)	6568977121	0
APTPGXK	Almen/Pel/Tos/Produccion x Kilo	5632696582	0
APTSPGXKPM	Almen/Pel/Tos/Sal/Produccion PARA MIX x Kilo	46679134937	0
APTSPGXK	Almen/Pel/Tos/Sal/Produccion x Kilo	5285969697	0
AGPX10Q	Almend/Gu/Partida x 10	151591476	23
AGPX2	Almend/Gu/Partida x 2	5256963685	-2
AGPX5	Almend/Gu/Partida x 5	5265282517	-1
AGRX10Q	Almend/Gu/Ramill x 10	151591475	33
AGCHX10	Almend/Guara/Chica x 10	4585231575	26
AGMX10	Almend/Guara/Med x 10	2563636987	6
APC25/27x10	Almend/Pel/Carmel 25/27 x 10	4644655215	15
APC25/27X2	Almend/Pel/Carmel 25/27 x 2	6624441529	-2
APC25/27X5	Almend/Pel/Carmel 25/27 x 5	7753356885	-7
APC27/30x10	Almend/Pel/Carmel 27/30 x 10	2511995748	4
APFX2K	Almend/Pel/Fileteada x 2 Kg	2525894671	-5
APFX5	Almend/Pel/Fileteada x 5 kg	2533633698	-8
APFX500G	Almend/Pel/Fileteada x 500 g	5265454548	-3
AFX10	Almend/Pel/Fileteda x 10	7791351135734	7
APGX2	Almend/Pel/Guara x 2	2369632584	-5
APGX5	Almend/Pel/Guara x 5	452136985	-2
APN10X1C	Almend/Pel/Non 10 X 1 Cumana	4525865458	10
APN25/2710X150G	Almend/Pel/Non 25/27 10 x 150 g.	5469235745	0
APN25/2730X150G	Almend/Pel/Non 25/27 30 x 150 g.	1591589512	0
APN25/27X10	Almend/Pel/Non 25/27 x 10 kg.	1568755487	18
APN25/27x2	Almend/Pel/Non 25/27 x 2	4582367758	-21.5
APN25/27X5	Almend/Pel/Non 25/27 x 5 kg.	59463291	-26
APNC27/30x10	Almend/Pel/Non 27/30 x 10	6332559668	2
APNx2	Almend/Pel/Non 27/30 x 2 kg	3116844585	-91
APN27/30X22,68	Almend/Pel/Non 27/30 x 22,68 Kg	5336925235	36
APN27/30X5	Almend/Pel/Non 27/30 x 5 kg	2255633148	-119
APN1x1	Almend/Pel/Non x 1	2256685477	10
APTSPGUP	Almend/Tosta/Salada (Unidad Productiva)	548362596455	0
APNSVMX10	Almend/Variedad/Med x 10	1952483753	3
ATyS10x150	Almendra T y Salada 10 x 150	4445598633	0
ATYSX1	Almendra T y Salada x 1	4654658522	-1
ATySx10	Almendra T y Salada x 10	11116528587	4
ATySx150	Almendra T y Salada x 150	2655693325	-190
ATySx2	Almendra T y Salada x 2	2563635280	-14.5
ATySx5	Almendra T y Salada x 5	2563637245	-10.44
AT10X1	Almendra Tostada 10 x 1	2556698547	12
AT10X150	Almendra Tostada 10 x 150	1528595471	0
ATX1	Almendra tostada x 1	6654428771	-8
ATX150	Almendra Tostada x 150	2615485915	-10
ATx2	Almendra Tostada x 2	2563635263	-14
ATx5	Almendra tostada x 5	2563637281	-21
APTSPGUPPM	Almendra/Tosta/Salada (Unidad Productiva) PARA MIX	4826352874	0
APN25/27X150G	Almendras x 150 g.	5349638547	-288
ADMFX10	Almidon/Maiz/Fecula x 10	4559686329	1
AMFX5	Almidon/Maiz/Fecula x 5	9886323263	0
AGCMX5	Anana/Glace/Cob/Mul x 5	7791351136373	7.4
AGCX2,5	Anana/Glace/Cub x 2,5	1515252585	-1
AGCX5	Anana/Glace/Cub x 5	7791351133624	25
AGCM4X5	Anana/Glace/Cub/Mul 4 x 5	2659698296	2
AGCVX5	Anana/Glace/Cub/Ver x 5	7791351131866	4
AGCRX5	AnanaGlace/Cub/Roj x 5	7791351132993	4
AD10x1	Arandano/Desecado 10 x 1	87791885411003	0
ADX11,34K	Arandano/Desecado x 11,34 Kg	402649	40
ADX2K	Arandano/Desecado x 2 Kg.	2563635621	-104
ADX5K	Arandano/Desecado x 5 Kg	2266335587	-19
ADP10X200G	Arandanos/Pasas 10 x 200 g	6366998545	0
ADP30X200G	Arandanos/Pasas 30 x 200 g	6695542287	0
ADPX200G	Arandanos/Pasas x 200 g	2659874515	-20
ABX10	Arroz Basmati x 10	5693383447	3
ABX5	Arroz Basmati x 5kg	2295586473	-1
ACx25	Arroz Carnaroli x 25kg	7791351145122	3
ACAx5	Arroz Carnaroli x 5kg.	2316885547	-6
APSX25	Arroz P/Sushi x 25	7791351134737	2
APSx 5	Arroz P/Sushi x 5	2563625467	-10
AIX5	Arroz/Inflado x 5	2448565523	0
AIX25	Arroz/Integral x 25	7791351134751	2
AINTX5	Arroz/Integral x 5	4563655899	0
AYX25	Arroz/Yamani x 25	9465598764	1
AYX30	Arroz/Yamani x 30	4486695271	3
AYX5	Arroz/Yamani x 5	256363529	-28
AP9-11X10	Avell/Pel/Chi(9-11) x 10	2115532368	13
AP9-11X5	Avell/Pel/Chi(9-11) x 5	5658745881	0
AP13-15X10	Avell/Pel/Gra(13-15) x 10	2288664415	14
AP15+X10	Avell/Pel/Gra(15++) x 10	1548596366	42
AP10x1	Avell/Pel/Med 10 x 1 kg Fraccion	2566339854	4
APx1K	Avell/Pel/Med x 1	4688772519	-2
AP11-13X10	Avell/Pel/Med(11-13) x 10	468232258	24
APX5	Avellanas Pe(Med). x 5	2563635532	-36
APx2	Avellanas Pel(Med). x 2	2563635537	-42.78
AAIx25	Avena Arroll Instantanea x 25	7791351132061	10
AAIx30	Avena Arroll Instantanea x 30	4468552138	11
AAIx5	Avena Arroll Instantanea x 5	7744550021	-45.4
AATFx5	Avena/Arro/Trad/Fina x 5	3526891565	-32
AATX5	Avena/Arro/Trad/Med x 5	3526892849	1
AATFX25	Avena/Arro/Tradicional/Fina x 25	7791351136779	9
AATGX25	Avena/Arroll/Trad/Gru x 25	2563632541	1
AATGX5	Avena/Arroll/Trad/Gru x 5	3256419852	-5
AC5X1	Azafran/5Cap x 1	6464582132	3
ACX10X5	Azafran/5Cap x 10	8676595214	0
AMx10	Azucar Mascabo x 10 kg	7791312000361	6
AMx5	Azucar Mascabo x 5 kg	7791312000354	-10
AROX25	Azucar Rubia Org. x 25	7995685442	1
ARBX10	Azucar Rubia x 10	5269632657	-1
ARBX5	Azucar Rubia x 5	2115668873	-1
AGX5	Azucar/Granulado x 5	2663265441	0
AZIMX10	Azucar/Impalpable x 10	6499721153	-1
ANX10	Azucar/Negra x 10	5242398865	-1
ANX5	Azucar/Negra x 5	4658225697	-2
BF24X50	Barra Flor  24 x 50 g.	6842648535	-271.83
BFX50G	Barra Flor (20u)  x Kilo	6842648527	-2
BFXP	Barra Flor (Unidad de Tanda Productiva)	2566599842	0
BF+12X50	Barra Flor 12 x 50 g.	2585669558	0
BFXUNI	Barra Flor x 50 gs.	267519	0
CABx2	Cacao/Alcalino/Barry x 2	3214521538	0
CABx25	Cacao/Alcalino/Barry x 25	4936528719	0
CABx5	Cacao/Alcalino/Barry x 5	45696548521	0
CMx2	Canela/Molida x 2kg	4658523697	0
CCP2X22,68	Cast/Caju/P2 x 22,68	2696958471	5
CCP3X22.68	Cast/Caju/P3 x 22.68	4683357158	8
CCS3x22B	Cast/Caju/S3 x 22,68 B	1652576458	2
CCTX1	Cast/Caju/Tos x 1 Kg	1676674943	-2
CCTX2	Cast/Caju/Tos x 2 Kg.	6611254685	-40
CCTX5	Cast/Caju/Tos x 5 Kg	6633665822	-38
CCTGXK	Cast/Caju/Tos/Produccion/Granel x Kilo	4422559966	0
CCTS10x150	Cast/Caju/Tos/Sal 10 x 150 g	9968112547	0
CCTS10X500	Cast/Caju/Tos/Sal 10 x 500	2522566363	0
CCTSx150	Cast/Caju/Tos/Sal x 150 g.	7544863325	-270
CCTSx2B	Cast/Caju/Tos/Sal x 2	2563632018	-49
CCW3TSX2268	Cast/Caju/Tos/Sal x 22,68 kg	5262852241	14
CCTSx5	Cast/Caju/Tos/Sal x 5	6611777777	-43
CCTYSX500	Cast/Caju/Tos/Sal x 500	2445586963	-10
CCTSGXK	Cast/Caju/Tos/Salada/Produccion/Granel x Kilo	3366998547	0
CCTX20	Cast/Caju/Tost x 20 kg	42251968857	2
CCWTX22,68	Cast/Caju/Tost x 22,68	6645221587	8
CCW410x1	Cast/Caju/W4 10 x 1 	9965821541	5
CCVW4X20	Cast/Caju/W4 vietnam x 20kg	7765776628	0
CCW4x1k	Cast/Caju/W4 x 1	1515959545	-6
CCW4X2	Cast/Caju/W4 x 2	2589524933	-84
CCW4X22,68	Cast/Caju/W4 x 22,68 	2585963354	80
CCW4X5	Cast/Caju/W4 x 5	7744550033	-114
CPPX1	Cast/Para/Partida x 1	5662219735	-3
CPPX3	Cast/Para/Partida x 3 Kg.	5669633587	6
CPPX20K	Cast/Pará/Pel x 19,96 Kg.	7791351135840	1
CPPX2K	Cast/Para/Pel x 2 Kg.	6633666666	-4
CPPx5K	Cast/Para/Pel x 5 kg.	6633777777	-2
CCTGXKUP	Castaña/Caju/Tos (Unidad Productiva)	1251251251	0
CCTSGXKUP	Castaña/Caju/Tos y Sal (UnidadProductiva)	4565855252314	0
CDHX14	Cebolla Deshidratada x 14	2596366958	0
CDHX5	Cebolla Deshidratada x 5	2586963632	0
CSC132-1545x5R	Cir/Bom/132-154 5 x 5 Rosali	2866593593	0
CSC132-154x5R	Cir/Bom/132-154 x 5 Rosali	7798055890167	0
CSC88-1105x5R	Cir/Bom/88-110 5 x 5 Rosali	2866593595	0
CSC88-110x5R	Cir/Bom/88-110 x 5 Rosali	7798055890143	8
CSCM110-1325x5	Cir/Bom/Mediana/110-132 5 x 5	2866593594	0
CSCM110-132x5	Cir/Bom/Mediana/110-132 x 5 	7798055890150	7
CCC88-110X10I	Cir/C/Car 88 - 110 x 10 	7798055890112	1
CPCRx5	Cir/Pre/Chica x 5 Rosali	7798055890259	11
CPGR3X5	Cir/Pre/Grande 3 x 5 Rosali	2866593179	0
CPGRX5	Cir/Pre/Grande x 5 Rosali	7798055890273	16
CPMR3x5	Cir/Pre/Mediana 3 x 5 Rosali	2866593235	0
CPMRx5	Cir/Pre/Mediana x 5 Rosali	7798055890266	-3
CCDEX11,34	Coco Escamas x 11.34	5693387443	11
CCDEX15	Coco Escamas x 15	8648597257	1
CCDEX2	Coco Escamas x 2 Kg.	2596687443	-25
CCDEX25	Coco Escamas x 25	7791351146471	4
CR10X1	Coco/Rall 10 x 1	1232525148	2
CRx2	Coco/Rall x 2	7539582346	-47.15
CRx25B	Coco/Rall x 25	2563693528	37
CRx5	Coco/Rall x 5	2525852547	-143
CDMX3	Copos/Maiz x 3 Kg.	2648215746	0
CDMX3,5	Copos/Maiz x 3,5	5263875468	4
CDM6X1	Crocante de Mani 6 x 1	77936420992990	0
CDMAX1	Crocante/Mani x 1	4325852152	0
CMAX1	Curcuma x 1 	2568582474	0
CRRYX1	Curry/Molido x 1	1652523628	0
CHVx1	Chau/Vainilla x 1 unid.	1693257454	0
CHVTX10	Chau/Vainilla x 10 unid.	1693257456	0
CHV1X25	Chau/Vainilla x 25 unid.	1693257457	0
CHVx5	Chau/Vainilla x 5 unid.	1693257455	-1
CHB10x1	Chip de Banana 10 x 1 Cumana	87791885409376	24
CHBx2	Chips de Banana x 2 kg	2563632015	-55
CHBx6.8	Chips de Banana x 6.8 kg	7537538526	34
CHNA5X1	Choco/Neg/Alm 5 x 1 kg.	2837552850	3
CHNAx1	Choco/Neg/Alm x 1 kg	2583691475	-14
CHNM5X1	Choco/Neg/Mani 5 x 1 k	2837552735	2
CHNMX1	Choco/Neg/Mani x 1 kg.	2837552731	-10
CHNP5X1	Choco/Neg/Pasas 5 x 1 kg.	2837552849	1
CHNPx1	Choco/Neg/Pasas x 1 kg.	2583691432	0
NFCx1	Chocolate/Naranja/Tira x 1 Kg	7798066799244	3
DTN5X5K	Damasco/Turco N 2 x 5 kg	8697426171128	4
DTN6X5	Damasco/Turco N°6 x 5 kg.	8697426175	2
DTX2	Damazco/Turco x 2	2659865328	-1
DSSCX10	Datil Sayer S/car x 10	5478963245	2
DACCDNX1	Datil/Algerian x 1 kg	4458566355	-1
DACCDNX5	Datil/Algerian x 5 kg	6131804000119	15.86
DADNSCX5	Datil/Algerian/Nour/SCarozo x 5	4645854634	7
DEx5	Datil/Egip x 5	6464466645	5.27
DEX500	Datil/Egip x 500 g	5645644546	0
DIMx1	Datil/Israel/Medjoul x 1	2517796438	0
DIMx5	Datil/Israel/Medjoul x 5	1568853375	4.38
DSX10	Datil/SAYER x 10	7791351141261	3
EMX2	Emp/Mix x 2 	6633998575	0
FDMX5	Fecula de mandioca x 5	1919193749	0
FLPX500	Frambuesa/Liofilizada x 500	2015856475	1
FLPX80	Frambuesa/Liofilizada x 80 g	736372396853	0
FEFX10K	Frut/Esc/Frunat x 10	77941725	0
FEOX10	Frut/Esc/Orieta x 10	4688754221	10
FEPX10	Frut/Esc/Picardia x 10	7792260000687	10
FGAX1K	Frut/G/Anana x 1 Kennilar	7798066795086	1
FGAIRX2,5	Frut/G/Anana/Rodaja x 2,5	5641773958	-3
FGAIRX5	Frut/G/Anana/Rodaja x 5	7791351133655	14
FGCX1K	Frut/G/Cereza x 1 Kennilar	779806679507	24
FGCx4	Frut/G/Cereza x 4 k	7791351132092	0
FCx1K	Frut/G/Comun x 1 kg. Kennilar	7798066790463	0
FCx4K	Frut/G/Comun x 4	5688423633	1
FCx2K	Frut/G/Comun, x 2 kg. Kennilar	7999335824	-2
FGHx2K	Frut/G/Higo x 2 Kennilar	7798066795024	1
FGKx1K	Frut/G/Kiwi x 1 Kg	7798066790135	10
FGLTx2K	Frut/G/Lim/Tiras x 2 kennilar	7798066799251	2
FGNTx2K	Frut/G/Nar/Tiras x 2 Kennilar	7798066795031	13
PGECM4 X5	Frut/G/Papaya/Multi 4 x 5	2585588521	2
PGECMX5	Frut/G/Papaya/Multi x 5	6322587746	0
FGATX1K	Frut/G/Trozos/Anana x 1	265532	2
FGTKx1	Frut/G/Trozos/Kiwi x 1 kg.	265633	12
FGTNx2	Frut/G/Trozos/Naranja x 2 kg.	265431	10
FNCX5	Frut/Nar/Tir/Con x 5	5326965841	0.91
FNX1	Frut/Nevada/Mix x 1	5685959658	0
FNMSFSX2K	Frut/Nevada/Mix/ x 2 kg	7798066790654	5
FGJCX2	FrutG/Jengibre/Cub x 2	4558582528	-5
FGJCX5	FrutG/Jengibre/Cub x 5	2837553357	2
EMB-7A3E5C	Fut/G/Kiwi Glaseado Rod 10 x 1	4384161983	0
GSCx5	Garban/Sauco/Co x 5 kilos	256364152	-6
GLX2	Garbanzo Lechoso x 2	2696358471	-2
GLX25	Garbanzo Lechozo x 25	5536998564	6
GLX5	Garbanzo Lechozo x 5 kg	1444236699	-27
GSCx25	Garbanzo Sauco x 25	9488532656	1
GSSX5	Gelatina/SinSabor x 5	5657548892	-1
GFGNFX1	Grana de Flor (Produccion) FINAL x kilo	6446985211	0
GFGN	Grana de Flor (Unidad de Tanda Productiva)	5265465128	0
GDF10X200G	Grana de Flor 10 x 200 g	3214878237	0
GDF10x500	Grana de Flor 10 x 500 g	2228467864	0
GDF30X200G	Grana de Flor 30 x 200 g	3214874259	0
GDF5x1	Grana de Flor 5 x 1 Kg	5568467864	0
GDF5X500G	Grana de Flor 5 x 500 g	76328500	0
GDFX1	Grana de Flor x 1 Kg	2233559964	-277
GDFX200G	Grana de Flor x 200 g	3214877854	-1075.2
GDFX500G	Grana de Flor x 500 g	76328	-105
GS5X1	Grana de Sol  5 x 1 Kg	7391913354	0
GSGNFX1	Grana de Sol (Produccion) FINAL x kilo	568823345	0
GSGN	Grana de Sol (Unidad de Tanda Productiva)	1259635357	0
GS10X200G	Grana de Sol 10 x 200 g	7537539518	0
GDS10x500	Grana de Sol 10 x 500 gr	2589876649	0
GS5X500G	Grana de Sol 5 x 500 g	73282500	0
GSX1	Grana de Sol X 1 Kg	1133559964	-188
GSX200G	Grana de Sol x 200 g	6464582433	-434
GSX500G	Grana de Sol x 500 g	73282	-85
HAX25	Harina de Arroz x 25	5564485211	1
HAx5	Harina de Arroz x 5	256301827	-1
HDC25	Harina de Coco x 25kg	7791351139886	2
HDCx5	Harina de Coco x 5 kg	256301127	-9
HACPX1	Harina/Alm-CP x 1	7979131346	1
HACPX10	Harina/Alm-CP x 10	9944332582	6
HDASP10X1	Harina/Almendras/SP 10 x 1	87791885410921	0
HASP5X1	Harina/Almendras/SP 5 x 1	7791885411356	-2
HASPx1	Harina/Almendras/SP x 1 kg	7791885410925	-67
HDSPX10k	Harina/Almendras/SP x 10	2563369871	4.5
HDAX11,34	Harina/Almendras/SP x 11,34 kg	4465598627	4
HDAX25	Harina/Avena x 25	3522541727	4
HDAX5	Harina/Avena x 5	3522545321	-11
HDCX25	Harina/Centeno x 25	1644955328	1
HDCEX5	Harina/Centeno x 5	7954552155	-5
HDGX25	Harina/Garbanzo x 25	243567865	3
HDGX5	Harina/Garbanzo x 5	468239677	-11
HIOX25	Harina/Inte/Organica x 25kg	2668875411	2
HIOX5	Harina/Inte/Organica x 5	4658252113	-10
HDMCX5	Harina/maiz x 5	9445772364	0
HMAX20	Harina/Maiz/Amilaceo x 20	8965547215	2
HMAX5	Harina/Maiz/Amilaceo x 5	6464466447	-4
HDTSX5	Harina/Trigo/Sarraceno x 5	5269529636	0
HBMx5	Higo/Blan x 5 M	6957754112	0
HNX1	Higo/Neg x 1	5235241452	-1
HNx5	Higo/Neg/Grande x 5 	534921185732	7.24
HTLN6x5	Higo/Turco/Lerida N°6 x 5 Kg	1568755524	5
HTLN4x5	Higo/Turco/Lerida Nº4 x 5 Kg	5566699852	3
HSPx15	Hongo/Seco (Peru) x 15	1568852636	7
HS10x500	Hongo/Seco 10 x 500 gr	5656565656	2
HSX5	Hongo/Seco x 5 Kg.	1568852633	-14
HSX1	Hongos secos x 1	2563637713	-30
JDX1,5	Jengibre/Dehidratado x 1,5	3774599888	6
JDX3	Jengibre/Deshidratado x 3	3552665232	3
JDX20	Jengibre/Dreshidratado x 20	4668522487	0
LDA12X1L	Leche de Almendras 12 x 1	5629696328	-1
LDC12X1L	Leche de Coco 12 x 1	4582675846	0
LDCX1L	Leche de Coco x 1 L	7791337007932	3
LDAX1L	Leche/SAzu/Almendras x 1 L	5998651974	19
LNX25	Lenteja Nacional x 25	566578986	0
LNX30	Lenteja Nacional x 30	89898956743	3
LNX5	Lenteja Nacional x 5 Kg.	468239699	-11
LRTX25	Lenteja/Roja/Turquia x 25	121267945	6
LRTX5	Lenteja/Roja/Turquia x 5	5252896643	-17
LCCHx1KG	Lentejas/Colores/Choco x 1kg	2563635468	0
LCX25	Lentejon/Canada x 25 kg.	5252569358	8
Lx45,36	Lentejon/Canada x 45,36	5634428287	0
LX5B	Lentejon/Canada x 5 	256363737	-40
LNC20X500	Lentejon/Canada(6,5mm) 20 x 500	5956454127	0
LX25	Lentejon/Nac x 25 KG	5678893456	0
LONX30	Lentejon/Nac x 30	9191733544	3
LNCNLx5	Lentejon/Nac x 5 kg	5266569375	-14
MCHX2	Maiz Chulpe x 2	6113532944	0
MPX25	Maiz Pisingallo x 25	2563256326	1
MPX5	Maiz Pisingallo x 5	2585282546	-1
MFX18	Maiz/F x 18	1169375842	11
MFX2,5	Maiz/F x 2,5 Kg	1119547562	-10
MFX20	Maiz/F x 20	2626665563	3
MFX5	Maiz/F x 5 Kg.	5698831478	-5
MFBX18	Maiz/F/Barbacoa x 18	4682554967	6
MFBx2,5	Maiz/F/Barbacoa x 2,5 kg	1119545479	-5
MFBX20	Maiz/F/Barbacoa x 20	5744699852	2
MFBX5	Maiz/F/Barbacoa x 5 kg	25825631478	-2
MFDQX2,5	Maiz/F/DQueso x 2,5	5773311459	-2
MFDQX20	Maiz/F/DQueso x 20	6464882744	0
MFQx5	Maiz/F/DQueso x 5	7766991427	-2
MFMYMX18	Maiz/F/Most/Miel x 18kg.	1933997755	4
MFMMx2,5	Maiz/F/Most/Miel x 2,5 kg	9964285773	-8
MFMMx20	Maiz/F/Most/Miel x 20	7791885409165	1
MFMMx5	Maiz/F/Most/Miel x 5 kg	1119547478	-2
MFMYM10X1C	Maiz/F/Mza/Miel 10 x 1 Cumana	87791885410976	0
MFQX	Maiz/F/Queso 10 x 1	2288655741	2.5
MFQX18	Maiz/F/Queso x 18	1971793758	5.22
MIX5	Maiz/Inflado x 5	5266995874	0
MPBX25	Maiz/Pisado/Blanco x 25	4565886937	3
MPBX5	Maiz/Pisado/Blanco x 5	2269985471	-21
MFX5KG	Mani Fileteado x 5 kg	2996638547	3
MCR50/60X25	Mani/50-60/Runner x 25	2585258546	3
MCR50/60X5	Mani/50-60/Runner x 5 Kg	6544566952	-11
MCCGXK2	Mani/Cas/Granel x 2	2563633019	0
MCCGx20	Mani/Cas/Granel x 20	5469632561	1
MCCGXK5	Mani/Cas/Granel x 5	2829371581	-2
MCVX2	Mani/Cas/Virg. x 2	5484455697	-57
MCVX20	Mani/Cas/Virg. x 20	7577432654	35
MCVX5	Mani/Cas/Virg. x 5	5269663577	-104.99
MRSx25G	Mani/Rep/Gra/Salado x 25	56712684	34
MRSSCJX25	Mani/Rep/Gran/Exp x 25	4658525471	7
MRSSGx2	Mani/Rep/Granel x 2	5266915345	-21
MRSSGx25	Mani/Rep/Granel x 25	6644998725	62
MRSSGx5	Mani/Rep/Granel x 5	9934254685	-82
MRSx2	Mani/Rep/Salado x 2 kg	5288646582	-3
MRSx5	Mani/Rep/Salado x 5 kg	5824254685	-34
MLLAX1	Manzanilla x 1	6696587431	0
MDGRx5	Med/Duraz/Grande Rosali x 5	7798055890204	0
MDGx5P	Med/Duraz/Med In x 5 	4526685514	4
MDMRx5	Med/Duraz/Mediano Rosali x 5 	7798055890211	0
MDMRx5CN	Med/Duraz/Mediano Rosali x 5 CN	3522542587	0
MRx5DF	Memb/Rub x 5 Don Francisco	7798079670127	4
MR4x5	Memb/Rub# 4 x 5 kg	7798079670122	0
MRPx24	Memb/Rub/Panes x 24	7794172100014	1
MRPx650	Memb/Rub/Panes x 650 g	7794172000014	3
MPGDFX6,9	Mezcla Grana Flor x 6,9 	4778531977	0
MPGDSX7	Mezcla Grana Sol x 7	4558772659	0
MPB	Mezcla p/ Barritas x 4 kg	5689515951	-16
MBX15	Miel Bidon x 15	2652100584	25
M12x500	Miel Pack 12 x 500 grs.	3497631478	4
M6x1	Miel Pack 6 x 1 kg	2522541765	3
MFSAF2x5	Mix/AlmaFrut 2 x 5	8856664712	0
MFSAFx5	Mix/AlmaFrut x 5	4937122588	-32
MFSAFXK	Mix/AlmaFrut x Kilo	45102938	0
MCT10X300	Mix/Col/Tropical 10 x 300	5641185472	0
MCT2X5	Mix/Col/Tropical 2 x 5	3336958487	0
MCTX300	Mix/Col/Tropical x 300	4664446585	-30
MCTX5	Mix/Col/Tropical x 5	6458265698	-265
MCTXK	Mix/Col/Tropical x KILO	6498588721	0
MEX10	Mix/Eco 2 x 5 kg	64758448	0
MEx5	Mix/Eco x 5	64758538	1
MFS10X1	Mix/F/Secas 10 x 1 kg	7894671125	0
MFS10X300G	Mix/F/Secas 10 x 300 g	3214878721	0
MFSx10	Mix/F/Secas 2 x 5	2352647812	0
MFS30X300G	Mix/F/Secas 30 x 300 g	3214878621	0
MFSx1	Mix/F/Secas x 1	5446998577	-7
MFSx2	Mix/F/Secas x 2	647585	-30
MFSX300G	Mix/F/Secas x 300 g	6633665899	-800
MFSx5	Mix/F/Secas x 5	2352648721	-482
MFSXK	Mix/F/Secas x KILO	2584541179	0
MFSBKx2X5	Mix/F/Secas/Bk 2 x 5	9877553412	0
MFSBKx5	Mix/F/Secas/Bk x 5	9877553411	-51
MFSBKXK	Mix/F/Secas/Bk x Kilo	0987654321	0
MFSBx10	Mix/F/Secas/CBanana 2 x 5 kg	64758467	0
MFSBx5	Mix/F/Secas/CBanana x 5	64758468	1
MFSPx10	Mix/F/Secas/Premium  2 x 5 kg	64758453	0
MFSP10X300	Mix/F/Secas/Premium 10 x 300	7616716793	0
MFSPX1	Mix/F/Secas/Premium x 1	6464879215	-1
MFSPX2	Mix/F/Secas/Premium x 2 	647584	-34
MFSPx300	Mix/F/Secas/Premium x 300	1678193428	-122
MFSPx5	Mix/F/Secas/Premium x 5	6475845	-72.87
MFSPXK	Mix/F/Secas/Premium x KILO	1595499327	0
MFSSP10X1	Mix/F/Secas/SPasas 10 x 1 kg	5337795165	0
MFSSPX10	Mix/F/Secas/SPasas 2 x 5 kg	2589631444	0
MFSSPx1	Mix/F/Secas/SPasas x 1 	6695582211	-9
MFSSPx2	Mix/F/Secas/SPasas x 2	2589631452	-49
MFSSPx5	Mix/F/Secas/SPasas x 5	2589631453	-114.83
MFSSOXK	Mix/F/Secas/SPasas X KILO	1955867743	0
MFST10X1	Mix/F/Secas/Tropical 10 x 1 kg.	7894674582	0
MFST10x300	Mix/F/Secas/Tropical 10 x 300	2582563254	0
MFSTX10	Mix/F/Secas/Tropical 2 x 5 kg	6475852738	0
MFSTx1	Mix/F/Secas/Tropical x 1 kg	5988634475	-5
MFSTx2	Mix/F/Secas/Tropical x 2	6475852378	-61
MFSTx300	Mix/F/Secas/Tropical x 300	4521563258	-846
MFSTx5	Mix/F/Secas/Tropical x 5	6475852873	-24.24
MFSTXK	Mix/F/Secas/Tropical x KILO	5554469932	0
MS10X300G	Mix/Salado 10 x 300 g	5824565451	0
MSx10	Mix/Salado 2 x 5 kg	2589631327	0
MS30X300G	Mix/Salado 30 x 300 g	5824565452	0
MS50X100G	Mix/Salado 50 x 100 g	5623128585	0
MSx2	Mix/Salado x 2 kg	2589631325	-50.67
MSX300G	Mix/Salado x 300 g	6633665883	-697
MSx5	Mix/Salado x 5 kg	2589631326	-317.42
MSXK	Mix/Salado x KILO	4522736584	0
MS51k	Mix/Semi/5/llas x 1 	2563639637	0
MS510X1	Mix/Semi/5/llas10 x 1 kg.	87791885134070	0
MSEGx5	Mix/Semillas x 5	4775457851	1.81
MSD10X1	Mix/Semillas/Desayuno 10 x 1 Kg.	4585226361	4
MSE10X1	Mix/Semillas/Ensalada 10 x 1 Kg.	2837449100	0
MSEx1	Mix/Semillas/Ensalada x 1 kg	7791885409318	0
NMGX1	Nuez Moscada en Grano x 1	2585664771	0
NC32-34X10K	Nuez/Cas/32-34 x 10	1599856452	3
NCC32/34X5	Nuez/Cas/32-34 x 5	4599566327	-2
NCC34/36X10	Nuez/Cas/34-36 x 10 Kg	1568852583	6.63
NCC34/36X5	Nuez/Cas/34-36 x 5 Kg	1568852582	-9
NC36+X10	Nuez/Cas/36+ x 10	46585225	7.18
NCC36+X5	Nuez/Cas/36+ x 5	5465857477	-15
NCLLAM2X5	Nuez/Cllo/AtMod 2 x 5	2525258977	0
NCLLE2X6	Nuez/Cllo/Ext 2 x 6	6835753688	4
NCLLEX6	Nuez/Cllo/Extra x 6	1427538699	-2
NCBxK	Nuez/Cu/ExtL x 2	2568585467	-14
NCELCH2x6	Nuez/Cu/ExtL/Ch 2 x 6	3113342588	29.5
NCELCHx6	Nuez/Cu/ExtL/Ch x 6 	6569985472	0
NCL2X5	Nuez/Cu/Light 2 x 5	5698547125	8.6
NMAMAF2X5	Nuez/Ma/Amb/Lig 2 x 5	73459885	6.63
NMALX5	Nuez/Ma/Amb/Lig x 5	5235847714	-1
NMELCHx10	Nuez/Ma/Ext/Ch 2 x 5	7575459535	95.81
NMECHAM10X200G	Nuez/Ma/ExtL 10 x 200 g	5996862117	0
NMECHAM30X200G	Nuez/Ma/ExtL 30 x 200 g	5338896425	0
NMECHAMX200G	Nuez/Ma/ExtL x 200 g	6633665884	-293
NMBE10X1K	Nuez/Ma/ExtL/Ch 10 x 1 Fraccion	7764852169	0
NMBEX1K	Nuez/Ma/ExtL/CH x 1	2586868959	-8
NMECHX2	Nuez/Ma/ExtL/Ch x 2	2563633011	-74.25
NMELCHx5	Nuez/Ma/ExtL/Ch x 5	2569478523	-94
NML10x1	Nuez/Ma/Light 10 x 1 kg Fraccion	2588526431	0
NML2X5	Nuez/Ma/Light 2 x 5	2876158742	56.8
NMLX2	Nuez/Ma/Light x 2	6663444158	0
NMLX5	Nuez/Ma/Light x 5	525642587	-32.64
NPM10	Nuez/Pecan/Mar 10 x 1 kilos	7765821541	3
NPM2X5	Nuez/Pecan/Mar 2 x 5	2837449373	24
NPM3X5	Nuez/Pecan/Mar 3 x 5	2597985457	2
NPMX1	Nuez/Pecan/Mar x 1 kg	2536362513	-13
NPM	Nuez/Pecan/Mar x 2 kilos	2563633359	-38.91
NPMx5	Nuez/Pecan/Mar x 5 kilos	2837449334	-9
Ox1	Oregano x 1	5693693659	0
CFX8	Pack Fracciones Consignacion	6958246175	0
PKX10	Panko x 10	6953481701505	2
PKX2	Panko x 2	2525254646	-6
PFx10L	Pasa/Flame x 10	4644755829	52
PJ3x10	Pasa/Jumbo 3 x 10kg	2526845687	0
PJx10	Pasa/Jumbo x 10	5349211857	22
PJx2	Pasa/Jumbo x 2	7744440032	-46
PAZx10	Pasa/Morocha TE x10	2653663548	10
PMx10M	Pasa/Moscatel x 10 M	7791351141858	1
PR10x1	Pasa/Rubia 10 x 1 kg Fraccion	7894256241	0
PR10X300GP	Pasa/Rubia 10 x 300 g	5263478956	0
PRx10	Pasa/Rubia x 10 	5388421595	46
PRx10P	Pasa/Rubia x 10 Pasrai	7791351133945	0.01
PRx2	Pasa/Rubia x 2	2563635713	-39
PRX300GP	Pasa/Rubia x 300 g	3214852246	8
PRJX10SW	Pasa/Rubia/Grande x 10	7791351141919	0
PRJX250GSW	Pasa/Rubia/Grande x 250 g	3214877733	36
PRX10K2	Pasa/Rubia/K2ll x 10	5656321452	26
PRX10K3	Pasa/Rubia/K3lll x 10	5335588974	32
PF10x1	Pasa/Sin/Semi 10 x 1 Fraccion	5337485655	1
PS10X300G	Pasa/Sulta 10 x 300 g	7537583428	0
PS30X300G	Pasa/Sulta 30 x 300 g	6869332746	0
PSx1	Pasa/Sulta x 1	4656547785	-1
PSx10	Pasa/Sulta x 10	5665485321	52
PSX300G	Pasa/Sulta x 300 g	2589588241	-18
PSTX5	Pasa/Sulta x 5	2546985652	-4
PSGX10	Pasa/Superior x 10	5698875223	1
PDMK12K380	Past/Mani/Nat 12 x 380	4522554115	0
PDMNO12X350	Past/Mani/Nat/Odd 12 x 350	17798043432710	0
PWCHx5	Pera/Wms/Chica x 5	5699653221	3
PWGx5	Pera/Wms/Grande x 5	7798055890174	4
PWMx5	Pera/Wms/Mediana x 5	7798055890181	3
PIX1	Piñones x 1	2536987415	1
PTyS10x500	Pist/Tost/Sal  10 x 500 	5465465287	0
PTySx500	Pist/Tost/Sal x 500	6778994587	0
PTS10x1	Pista/Tos/Sal 10 x 1	6693325415	6
PTS10X150G	Pistach/Tos/Sal 10 x 150 g	3214878521	0
PTS30X150G	Pistach/Tos/Sal 30 x 150 g	3214878421	0
PTSx10	Pistach/Tos/Sal x 10 	2157853972	27
PTSX150G	Pistach/Tos/Sal x 150 g	6633665821	-165
PTSx2	Pistach/Tos/Sal x 2	2837449303	-94
PTSx5	Pistach/Tos/Sal x 5	2563635045	-37
PTSx11,34	Pistach/Tos/Sal/Imp. x 11,34	1949495454	7
PTCCSSX10	Pistach/Tos/SinSal x 10	5565652526	0
PPC10x1	Pistacho/Pel/Crudo 10 x 1	7785446931	10
PPCXK	Pistacho/Pel/Crudo x 1 K	2563633001	-157
PNx10	Pistacho/Pel/Crudo x 10	2157854650	8
PPCX5	Pistacho/Pel/Crudo x 5	2157854637	-3
PDHx4	Polvo de Hornear x 4	5666214758	0
PADx25	Poroto Aduki x 25	1212345678	0
PAx5	Poroto Aduki x 5	4682346628	3
PAX25	Poroto Alubia x 25	9986332561	2
PALUx5	Poroto Alubia x 5	468237726	-5
PCDX25	Poroto Colorado Dark x 25	7791351138001	1
PCDx5	Poroto Colorado Dark x 5	256335698	4
PCx25	Poroto Cramberry x 25	6445822139	2
PCBX30	Poroto Cramberry x 30	65785432	1
PCx5	Poroto Cramberry x 5	468237651	2
PDCX5	Poroto de Caupi x 5	152856477	0
PMX25	Poroto Mung x 25	2696635884	1
PoMx5	Poroto Mung x 5	3522545846	1
PNX25	Poroto Negro x 25	7791351132641	5
PNx5	Poroto Negro x 5 kg	468237632	-6
PMX10	Poroto/Mung x 10	7791351139909	0
PPx25	Porotos Pallares x 25	2285669475	3
PPX5	Porotos Pallares x 5	71242635128	-14
QP4,5	Quinoa Pop x 4,5	4646464658	1
ROMX1	Romero x 1	8856447578	0
EMB-JK1OOX	Pasa Jumbo x 1 kg	4324664680	0
ROMX25	Romero x 25	8856447577	1
ROMX500	Romero x 500 g.	4648842553	0
ADAX25	Salvado de Avena x 25 Kg.	9731791334	2
ADAX5	Salvado de Avena x 5 Kg.	2589967728	-7
SPYx1	Sem/Psyllium x 1	6698442589	-2
EMB-601GSR	Jengibre en cubos x 1	5765752086	0
SPYx25	Sem/Psyllium x 25	3596963584	1
SPYx5	Sem/Psyllium x 5	2688756344	0
SDHX1	Semilla de Hinojo x 1	4654585521	0
SDAx25	Semilla/Amaranto x 25	56296578	0
SDAx5	Semilla/Amaranto x 5	2585856421	5
SCHx2M	Semilla/chia x 2	7796658842	-3
SCHX25M	Semilla/Chia x 25	2569373194	0
SCHx5M	Semilla/Chia x 5	5647732819	-4
SCHx2	Semilla/Chia/Gris x 2	3386442597	-12.54
SCHX25	Semilla/Chia/Gris x 25	98765432	13
SCHx5	Semilla/Chia/Gris x 5 Kg	468234135	-45.1
SLX2	Semilla/Lino x 2 Kg	6595685621	-3
SLX25	Semilla/Lino x 25	67545433	5
SLX5	Semilla/Lino x 5 Kg	256313827	-17
SZAX5	Semilla/Zapallo A x 1 kilo	2563633330	-1
SZAX25	Semilla/Zapallo A x 25	5568747282	4
SZPX10	Semilla/Zapallo A x 5	2563633220	1
SZAAX1	Semilla/Zapallo AA x 1	7791885409493	-165
SZAAX25	Semilla/Zapallo AA x 25	5696638849	18
SZAAx5	Semilla/Zapallo AA x 5	53468556	-32
EMB-LS1ILU	Bolsas 40 x 50 x 100	1409587575	0
SAA10X1	Semillas/Amap/Azul 10 x 1	87791885409482	0
SAAX1	Semillas/Amap/Azul x 1	7791885409486	-26
SAAX25	Semillas/Amap/Azul x 25	3226675843	2
SAAX5	Semillas/Amap/azul x 5kg	2567394128	-1
SGx2	Semillas/Girasol x 2	5645647349	-10
SGx5	Semillas/Girasol x 5	5645649999	-26
SGP10X1	Semillas/Girasol/Pel 10 x 1	7585488547	8
SGPX2268	Semillas/Girasol/Pel x 22,68 Kg.	8644339581	7
SGPX25	Semillas/Girasol/Pel x 25	564789765	10
SGIX2268	Semillas/Girasol/Pel/I x 22,68	1541125698	1
QRX1	Semillas/Quinoa x 1	4588221533	-3
SQx5	Semillas/Quinoa x 5	2563699582	-21.83
SQRx25	Semillas/Quinoa/Real x 25	5243698752	5
SBx1	Sesamo Blanco x 1	8229336744	-13
SBx25	Sesamo Blanco x 25	434348976	15
SBX5	Sesamo Blanco x 5	256362258	-74
SSB10X1K	Sesamo/Blanco 10 x 1	4564588521	6
SNIX2	Sesamo/Nat/Integral x 2	2563537154	-1
SNIX25	Sesamo/Nat/Integral x 25	34347863	4
SNIX5	Sesamo/Nat/Integral x 5	468233341	-13
SNx1	Sesamo/Negro x 1 kg.	2563636523	-24
SNX25	Sesamo/Negro x 25	6485552315	3
SNX5	Sesamo/Negro x 5 Kg.	468235624	-6
STGx20	Soja/Tex/Gruesa x 20 kg	59467125	0
TSFX5	Text/Soja/Fino x 5	3522541765	0
TGX5	Text/Soja/Gruesa x 5	3526891765	1
TSE2x3	Tom/Sec/Esp 2 x 3 kg.	2266997744	2
TSEx3	Tom/Sec/Esp x 3 kg	1568753151	-26
TSEx5	Tom/Sec/Esp. x 5	1568753152	5.41
TSX10	Tomate Seco x 10 k	2684686682	12
TT10x8M	Tomate/Tri 10 Pack 8 x 1	5466332588	0
TT8x1M	Tomate/Tri 8 x 1 Moreno	1234500689	42.37
TBX5	Trigo Burgol Fino x 5	6565959585	0
\.


--
-- Data for Name: bunker_articulos; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.bunker_articulos (articulo_id, costo_base, porcentaje_iva, moneda, redondeo, mantener_utilidad, rubro, sub_rubro, no_producido_por_lambda, kilos_unidad, es_pack, pack_hijo_codigo, propiedades_dinamicas, descripcion, descripcion_generada, expresado_en_gramos, expresado_en_unidades, pack_unidades, familia_id) FROM stdin;
NMAMAF2X5	115100.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	NUECES	f	10.00	f	\N	{"familia_id": 1, "posiciones": {"pos_1": {"eje": "conformacion", "valor": "Peladas", "posicion": 1, "silencioso": true, "abreviatura": "PADA", "modo_display": "COMPLETO"}, "pos_2": {"eje": "variedad", "valor": "Chandler", "posicion": 2, "silencioso": false, "abreviatura": "CHLER", "modo_display": "ABREVIADO"}, "pos_4": {"eje": "tratamiento", "valor": "Mariposa", "posicion": 4, "silencioso": false, "abreviatura": "MPSA", "modo_display": "ABREVIADO"}, "pos_5": {"eje": "color", "valor": "Ambar Light", "posicion": 5, "silencioso": false, "abreviatura": "AMLGHT", "modo_display": "ABREVIADO"}}, "familia_nombre": "Frutos Secos", "articulo_principal": "Nuez"}	Nuez	Nuez CHLER MPSA AMLGHT x 10kg	f	f	1	1
LNX5	10100.00	10.50	($)Pesos	Ninguno	t	LEGUMBRES	LEJAS	f	5.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Lentejas"}	Lentejas	Lentejas.NNAL x 5kg	f	f	1	41
APN1x1	15650.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	ALMENDRAS	f	1.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Almendra"}	Almendra	Almendra.NP.27/30.PEL/ENT x 1kg	f	f	1	41
EMB-LS1ILU	35000.00	21.00	($)Pesos	Ninguno	t	\N	\N	f	0.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Bolsas 40 x 50"}	Bolsas 40 x 50	Bolsas.40/50.PKU x 100 unidades	f	t	100	41
MFSTXK	0.00	21.00	($)Pesos	Ninguno	t	PRODUCCION	MIX	f	1.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Mix Frutos Secos"}	Mix Frutos Secos	Mix Frutos Secos.TRPCAL.GNEL x 1kg	f	f	1	41
LCX25	65700.00	10.50	($)Pesos	Ninguno	t	LEGUMBRES	LEJAS	f	25.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Lentejon Canada"}	Lentejon Canada	Lentejon Canada.N2 x 25kg	f	f	1	41
NCBxK	27420.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	NUECES	f	2.00	f	\N	{"familia_id": 1, "posiciones": {"pos_1": {"eje": "conformacion", "valor": "Peladas", "posicion": 1, "silencioso": true, "abreviatura": "PADA", "modo_display": "COMPLETO"}, "pos_2": {"eje": "variedad", "valor": "Chandler", "posicion": 2, "silencioso": false, "abreviatura": "CHLER", "modo_display": "ABREVIADO"}, "pos_4": {"eje": "tratamiento", "valor": "Cuarto", "posicion": 4, "silencioso": false, "abreviatura": "CTO", "modo_display": "COMPLETO"}, "pos_5": {"eje": "color", "valor": "Extra light", "posicion": 5, "silencioso": false, "abreviatura": "EXLIGHT", "modo_display": "ABREVIADO"}}, "familia_nombre": "Frutos Secos", "asistente_minutos": 5, "articulo_principal": "Nuez", "asistente_colaborador_id": 5}	Nuez	Nuez CHLER Cuarto EXLIGHT x 2kg	f	f	1	1
HTLN4x5	101400.00	21.00	($)Pesos	Ninguno	t	FRUTAS DISECADAS	HIGOS	f	5.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Higo Turco"}	Higo Turco	Higo Turco.N4 x 5kg	f	f	1	41
LX5B	13140.00	21.00	($)Pesos	Ninguno	t	\N	\N	f	5.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Lentejon"}	Lentejon	Lentejon.CDA.N2 x 5kg	f	f	1	41
APN25/27X150G	2500.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	ALMENDRAS	f	0.15	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Almendra"}	Almendra	Almendra.PEL/ENT.NP x 150g	t	f	1	41
APN25/2710X150G	25000.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	ALMENDRAS	f	1.50	t	APN25/27X150G	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Almendra"}	Almendra	Almendra.NP.ETRA 10 x 150g	t	f	10	41
MCT10X300	29000.00	21.00	($)Pesos	Ninguno	t	\N	\N	f	3.00	t	MCTX300	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Mix Frutos Secos"}	Mix Frutos Secos	Mix Frutos Secos.COLTR 10 x 300g	t	f	10	41
MCTX300	2900.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	MIX	f	0.30	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Mix Frutos Secos"}	Mix Frutos Secos	Mix Frutos Secos.COLTR x 300g	t	f	1	41
PPX5	19900.00	10.50	($)Pesos	Ninguno	t	LEGUMBRES	PALLARES	f	5.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Porotos Pallares"}	Porotos Pallares	Porotos Pallares x 5kg	f	f	1	41
MCTXK	0.00	21.00	($)Pesos	Ninguno	t	PRODUCCION	MIX	f	1.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Mix Frutos Secos"}	Mix Frutos Secos	Mix Frutos Secos.GNEL.COLTR x 1kg	f	f	1	41
MFST10x300	31500.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	MIX	f	3.00	t	MFSTx300	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Mix Frutos Secos"}	Mix Frutos Secos	Mix Frutos Secos.TRPCAL 10 x 300g	t	f	10	41
APTPGXK	219.54	21.00	($)Pesos	Ninguno	t	PRODUCCION	ALMENDRAS	f	1.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Almendra"}	Almendra	Almendra.GNEL.TOTDO.NP x 1kg	f	f	1	41
MCVX5	13110.00	21.00	($)Pesos	Ninguno	t	\N	\N	f	5.00	f	\N	{"familia_id": 1, "posiciones": {"pos_1": {"eje": "conformacion", "valor": "Con cascara", "posicion": 1, "silencioso": false, "abreviatura": "C/CAS", "modo_display": "ABREVIADO"}, "pos_2": {"eje": "variedad", "valor": "Virginia", "posicion": 2, "silencioso": false, "abreviatura": "VGNA", "modo_display": "COMPLETO"}}, "familia_nombre": "Frutos Secos", "asistente_minutos": 5, "articulo_principal": "Mani", "silencioso_principal": false, "modo_display_principal": "COMPLETO", "asistente_colaborador_id": 5}	Mani	Mani C/CAS Virginia x 5kg	f	f	1	1
CCTSx2B	26340.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	CASTAÑAS	f	2.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Castañas de caju"}	Castañas de caju	Castañas de caju.TOS Y SAL x 2kg	f	f	1	41
ATX150	2480.00	21.00	($)Pesos	Ninguno	t	\N	\N	f	0.15	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Almendra"}	Almendra	Almendra.TOTDO x 150g	t	f	1	41
CCTSx150	2150.00	21.00	($)Pesos	Ninguno	t	\N	\N	f	0.15	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Castañas de caju"}	Castañas de caju	Castañas de caju.TOS Y SAL x 150g	t	f	1	41
NCELCH2x6	164500.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	NUECES	f	12.00	f	\N	{"familia_id": 1, "posiciones": {"pos_1": {"eje": "conformacion", "valor": "Peladas", "posicion": 1, "silencioso": true, "abreviatura": "PADA", "modo_display": "COMPLETO"}, "pos_2": {"eje": "variedad", "valor": "Chandler", "posicion": 2, "silencioso": false, "abreviatura": "CHLER", "modo_display": "ABREVIADO"}, "pos_4": {"eje": "tratamiento", "valor": "Cuarto", "posicion": 4, "silencioso": false, "abreviatura": "CTO", "modo_display": "COMPLETO"}, "pos_5": {"eje": "color", "valor": "Extra light", "posicion": 5, "silencioso": false, "abreviatura": "EXLIGHT", "modo_display": "ABREVIADO"}}, "familia_nombre": "Frutos Secos", "asistente_minutos": null, "articulo_principal": "Nuez", "asistente_colaborador_id": null}	Nuez	Nuez CHLER Cuarto EXLIGHT x 12kg	f	f	1	1
NCL2X5	105000.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	NUECES	f	10.00	f	\N	{"familia_id": 1, "posiciones": {"pos_1": {"eje": "conformacion", "valor": "Peladas", "posicion": 1, "silencioso": true, "abreviatura": "PADA", "modo_display": "COMPLETO"}, "pos_2": {"eje": "variedad", "valor": "Chandler", "posicion": 2, "silencioso": false, "abreviatura": "CHLER", "modo_display": "ABREVIADO"}, "pos_4": {"eje": "tratamiento", "valor": "Cuarto", "posicion": 4, "silencioso": false, "abreviatura": "CTO", "modo_display": "COMPLETO"}, "pos_5": {"eje": "color", "valor": "Extra light", "posicion": 5, "silencioso": false, "abreviatura": "EXLIGHT", "modo_display": "ABREVIADO"}}, "familia_nombre": "Frutos Secos", "articulo_principal": "Nuez"}	Nuez	Nuez CHLER Cuarto EXLIGHT x 10kg	f	f	1	1
MFSPx5	88300.00	21.00	($)Pesos	Ninguno	t	\N	\N	f	5.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Mix Frutos Secos"}	Mix Frutos Secos	Mix Frutos Secos.PIUN x 5kg	f	f	1	41
EMB-X8SLNC	1.00	21.00	($)Pesos	Ninguno	t	\N	\N	f	12.00	f	\N	{"familia_id": 1, "posiciones": {"pos_1": {"eje": "conformacion", "valor": "Peladas", "posicion": 1, "silencioso": true, "abreviatura": "PADA", "modo_display": "COMPLETO"}, "pos_2": {"eje": "variedad", "valor": "Chandler", "posicion": 2, "silencioso": false, "abreviatura": "CHLER", "modo_display": "ABREVIADO"}, "pos_4": {"eje": "tratamiento", "valor": "Cuarto", "posicion": 4, "silencioso": false, "abreviatura": "CTO", "modo_display": "COMPLETO"}, "pos_5": {"eje": "color", "valor": "Light", "posicion": 5, "silencioso": false, "abreviatura": "LHT", "modo_display": "ABREVIADO"}}, "familia_nombre": "Frutos Secos", "articulo_principal": "Nuez", "codigo_barras_local": "3837483164"}	Nuez	Nuez CHLER Cuarto LHT x 12kg	f	f	1	1
MFSPx300	5500.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	MIX	f	0.30	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Mix Frutos Secos"}	Mix Frutos Secos	Mix Frutos Secos.PIUN x 300g	t	f	1	41
MSx5	37650.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	MIX	f	5.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "asistente_minutos": 5, "articulo_principal": "Mix Salado", "asistente_colaborador_id": 5}	Mix Salado	Mix Salado x 5kg	f	f	1	41
SNIX5	9700.00	10.50	($)Pesos	Ninguno	t	SEMILLAS	SESAMO	f	5.00	f	\N	{"familia_id": 2, "posiciones": {"pos_2": {"eje": "conformacion", "valor": "Integral", "posicion": 2, "silencioso": false, "abreviatura": "IGRAL", "modo_display": "COMPLETO"}}, "familia_nombre": "Semillas", "asistente_minutos": 5, "articulo_principal": "Sesamo", "asistente_colaborador_id": 5}	Sesamo	Sesamo Integral x 5kg	f	f	1	2
MSXK	0.00	21.00	($)Pesos	Ninguno	t	PRODUCCION	MIX	f	1.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "asistente_minutos": 20, "articulo_principal": "Mix Salado", "asistente_colaborador_id": 5}	Mix Salado	Mix Salado.GNEL x 1kg	f	f	1	41
CCTSGXK	219.54	21.00	($)Pesos	Ninguno	t	PRODUCCION DE INGREDIENTES	CASTAÑAS	f	1.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Castañas de caju"}	Castañas de caju	Castañas de caju.GNEL.TOS Y SAL x 1kg	f	f	1	41
PTSX150G	3500.00	21.00	($)Pesos	Ninguno	t	\N	\N	f	0.15	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Pistacho"}	Pistacho	Pistacho.TOS Y SAL.C/CAS x 150g	t	f	1	41
CCTS10x150	21500.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	CASTAÑAS	f	1.50	t	CCTSx150	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Castañas de caju"}	Castañas de caju	Castañas de caju.TOS Y SAL 10 x 150g	t	f	10	41
MFSTx2	19680.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	MIX	f	2.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Mix Frutos Secos"}	Mix Frutos Secos	Mix Frutos Secos.TRPCAL x 2kg	f	f	1	41
MFSPX1	17660.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	MIX	f	1.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Mix"}	Mix	Mix.PIUN x 1kg	f	f	1	41
CHB10x1	70787.00	21.00	($)Pesos	Ninguno	t	DESHIDRATADOS	BANANA	f	10.00	t	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Chip Banana"}	Chip Banana	Chip Banana 10 x 1kg	f	f	1	41
APC27/30x10	150000.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	ALMENDRAS	f	10.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "ALMENDRA"}	ALMENDRA	ALMENDRA.CRMEL.27/30 x 10kg	f	f	1	41
MFMMx2,5	22000.00	21.00	($)Pesos	Ninguno	t	CEREALES	MAIZ	f	2.50	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Maiz Frito"}	Maiz Frito	Maiz Frito.MZA/MIEL x 2.5kg	f	f	1	41
MFSSPx5	60100.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	MIX	f	5.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Mix Frutos Secos"}	Mix Frutos Secos	Mix Frutos Secos.SINPSAS x 5kg	f	f	1	41
EMB-601GSR	22.00	21.00	($)Pesos	Ninguno	t	FRUTAS GLASEADAS	JENGIBRE	f	1.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Jengibre en Cubos"}	Jengibre en Cubos	Jengibre en Cubos x 1kg	f	f	1	41
GDF10X200G	23000.00	21.00	($)Pesos	Ninguno	t	CEREALES	GRANOLA	f	2.00	t	GDFX200G	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Grana Flor"}	Grana Flor	Grana Flor 10 x 200g	t	f	10	41
GDFX500G	5200.00	21.00	($)Pesos	Ninguno	t	CEREALES	GRANOLA	f	0.50	f	GFGNFX1	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Grana Flor"}	Grana Flor	Grana Flor x 500g	t	f	1	41
SQx5	28270.00	10.50	($)Pesos	Ninguno	t	SEMILLAS	QUINOA	f	5.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Semilla de Quinoa"}	Semilla de Quinoa	Semilla de Quinoa x 5kg	f	f	1	41
MPB	60000.00	21.00	($)Pesos	Ninguno	t	PRODUCCION	MEZCLA	f	4.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Mezcla Barritas"}	Mezcla Barritas	Mezcla Barritas.MIX x 4kg	f	f	1	41
ATX1	16500.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	ALMENDRAS	f	1.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Almendra"}	Almendra	Almendra.ETRA.TOTDO.NP.27/30 x 1kg	f	f	1	41
APNx2	30960.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	ALMENDRAS	f	2.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Almendra"}	Almendra	Almendra.PEL/ENT.NP.27/30 x 2kg	f	f	1	41
PTSx10	250000.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	PISTACHO	f	10.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Pistacho"}	Pistacho	Pistacho.TOS Y SAL.C/CAS x 10kg	f	f	1	41
CRx25B	168500.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	COCO	f	25.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Coco Rallado"}	Coco Rallado	Coco Rallado x 25kg	f	f	1	41
EMB-POIULR	264.22	21.00	($)Pesos	Ninguno	t	INSUMOS	CAJAS	f	0.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "CAJA MICRO M/M 20X20X10"}	CAJA MICRO M/M 20X20X10	CAJA MICRO M/M.IDP x 1 unidad	f	t	1	41
MFSx1	7040.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	MIX	f	1.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Con Pasas"}	Con Pasas	Con Pasas.MIX x 1kg	f	f	1	41
EMB-W2DGA9	18.16	21.00	($)Pesos	Ninguno	t	INSUMOS	BOLSITA	f	1.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "BOLSA 8X15 40 MIC"}	BOLSA 8X15 40 MIC	BOLSA 40 MIC.IDP x 1 unidad	f	t	1	41
MFSx5	35200.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	MIX	f	5.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Con Pasas"}	Con Pasas	Con Pasas.MIX x 5kg	f	f	1	41
NMELCHx10	163900.00	21.00	($)Pesos	Ninguno	f	FRUTOS SECOS	NUECES	t	10.00	f	\N	{"familia_id": 1, "posiciones": {"pos_1": {"eje": "conformacion", "valor": "Peladas", "posicion": 1, "silencioso": true, "abreviatura": "PADA", "modo_display": "COMPLETO"}, "pos_2": {"eje": "variedad", "valor": "Chandler", "posicion": 2, "silencioso": false, "abreviatura": "CHLER", "modo_display": "ABREVIADO"}, "pos_4": {"eje": "tratamiento", "valor": "Mariposa", "posicion": 4, "silencioso": false, "abreviatura": "MPSA", "modo_display": "COMPLETO"}, "pos_5": {"eje": "color", "valor": "Extra light", "posicion": 5, "silencioso": false, "abreviatura": "EXLIGHT", "modo_display": "ABREVIADO"}}, "familia_nombre": "Frutos Secos", "asistente_minutos": null, "articulo_principal": "Nuez", "asistente_colaborador_id": null}	Nuez	Nuez CHLER Mariposa EXLIGHT x 10kg	f	f	1	1
MPX25	25000.00	21.00	($)Pesos	Ninguno	t	CEREALES	MAIZ	f	25.00	f	\N	{"familia_id": 27, "posiciones": {"pos_1": {"eje": "variedad", "valor": "Pisingallo", "posicion": 1, "silencioso": false, "abreviatura": "PIGLLO", "modo_display": "COMPLETO"}}, "familia_nombre": "Cereales", "asistente_minutos": null, "articulo_principal": "Maiz", "asistente_colaborador_id": null}	Maiz	Maiz Pisingallo x 25kg	f	f	1	27
SBx25	96500.00	10.50	($)Pesos	Ninguno	t	SEMILLAS	SESAMO	f	25.00	f	\N	{"familia_id": 2, "posiciones": {"pos_1": {"eje": "color", "valor": "Blanco", "posicion": 1, "silencioso": false, "abreviatura": "BCO", "modo_display": "COMPLETO"}}, "familia_nombre": "Semillas", "asistente_minutos": null, "articulo_principal": "Sesamo", "asistente_colaborador_id": null}	Sesamo	Sesamo Blanco x 25kg	f	f	1	2
GSCx25	34100.00	10.50	($)Pesos	Ninguno	t	LEGUMBRES	GARBANZO	f	25.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Garbanzo"}	Garbanzo	Garbanzo.SCO x 25kg	f	f	1	41
MFSXK	0.00	21.00	($)Pesos	Ninguno	t	PRODUCCION DE INGREDIENTES	MIX	f	1.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Con pasas X KILO"}	Con pasas X KILO	Con pasas X KILO.MIX x 1kg	f	f	1	41
ADX11,34K	1500.00	21.00	($)Pesos	Ninguno	f	FRUTAS DISECADAS	ARANDANOS	f	11.34	f	\N	{"familia_id": 26, "posiciones": {"pos_1": {"eje": "variedad", "valor": "Arandanos", "posicion": 1, "silencioso": false, "abreviatura": "ARDAS", "modo_display": "COMPLETO"}, "pos_2": {"eje": "conformacion", "valor": "Sin Semillas", "posicion": 2, "silencioso": true, "abreviatura": "SSLLAS", "modo_display": "COMPLETO"}, "pos_3": {"eje": "color", "valor": "Rojo", "posicion": 3, "silencioso": true, "abreviatura": "RJO", "modo_display": "COMPLETO"}, "pos_4": {"eje": "tratamiento", "valor": "Pasas", "posicion": 4, "silencioso": false, "abreviatura": "PSA", "modo_display": "COMPLETO"}}, "familia_nombre": "Frutas Disecadas", "asistente_minutos": null, "articulo_principal": "Pasas de", "silencioso_principal": true, "modo_display_principal": "COMPLETO", "asistente_colaborador_id": null}	Pasas de	Arandanos Pasas x 11.34kg	f	f	1	26
AAIx25	30760.00	21.00	($)Pesos	Ninguno	t	CEREALES	AVENA	f	25.00	f	\N	{"familia_id": 27, "posiciones": {"pos_1": {"eje": "tratamiento", "valor": "Arrollada", "posicion": 1, "silencioso": false, "abreviatura": "ALLDA", "modo_display": "ABREVIADO"}, "pos_2": {"eje": "conformacion", "valor": "Instantanea", "posicion": 2, "silencioso": false, "abreviatura": "ITNEA", "modo_display": "COMPLETO"}}, "familia_nombre": "Cereales", "asistente_minutos": null, "articulo_principal": "Avena", "silencioso_principal": false, "modo_display_principal": "COMPLETO", "asistente_colaborador_id": null}	Avena	Avena ALLDA Instantanea x 25kg	f	f	1	27
SZAAx5	41240.00	10.50	($)Pesos	Ninguno	t	SEMILLAS	ZAPALLO	f	5.00	f	SZAAX25	{"familia_id": 2, "posiciones": {"pos_1": {"eje": "color", "valor": "Verde", "posicion": 1, "silencioso": true, "abreviatura": "VDE", "modo_display": "COMPLETO"}, "pos_2": {"eje": "conformacion", "valor": "Doble A", "posicion": 2, "silencioso": false, "abreviatura": "AA", "modo_display": "ABREVIADO"}}, "familia_nombre": "Semillas", "asistente_minutos": 5, "articulo_principal": "Zapallo", "silencioso_principal": false, "modo_display_principal": "COMPLETO", "asistente_colaborador_id": 5}	Zapallo	Zapallo AA x 5kg	f	f	1	2
SBX5	19300.00	10.50	($)Pesos	Ninguno	t	SEMILLAS	SESAMO	f	5.00	f	\N	{"familia_id": 2, "posiciones": {"pos_1": {"eje": "color", "valor": "Blanco", "posicion": 1, "silencioso": false, "abreviatura": "BCO", "modo_display": "COMPLETO"}}, "familia_nombre": "Semillas", "asistente_minutos": 5, "articulo_principal": "Sesamo", "asistente_colaborador_id": 5}	Sesamo	Sesamo Blanco x 5kg	f	f	1	2
SNX5	37100.00	10.50	($)Pesos	Ninguno	t	SEMILLAS	SESAMO	f	5.00	f	\N	{"familia_id": 2, "posiciones": {"pos_1": {"eje": "color", "valor": "Negro", "posicion": 1, "silencioso": false, "abreviatura": "NGRO", "modo_display": "COMPLETO"}}, "familia_nombre": "Semillas", "asistente_minutos": null, "articulo_principal": "Sesamo", "asistente_colaborador_id": null}	Sesamo	Sesamo Negro x 5kg	f	f	1	2
PAx5	8500.00	10.50	($)Pesos	Ninguno	t	LEGUMBRES	ADZUKI	f	5.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Poroto Adzuki"}	Poroto Adzuki	Poroto Adzuki x 5kg	f	f	1	41
PTS10X150G	35000.00	21.00	($)Pesos	Ninguno	t	\N	\N	f	1.50	t	PTSX150G	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Pista"}	Pista	Pista.TOS Y SAL.C/CAS 10 x 150g	t	f	10	41
AT10X150	24800.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	ALMENDRAS	f	1.50	t	ATX150	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Almendra"}	Almendra	Almendra.TOTDO 10 x 150g	t	f	10	41
MFSP10X300	55000.00	21.00	($)Pesos	Ninguno	t	\N	\N	f	3.00	t	MFSPx300	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Mix Frutos Secos"}	Mix Frutos Secos	Mix Frutos Secos.PIUN 10 x 300g	t	f	10	41
AMx5	13750.00	21.00	($)Pesos	Ninguno	t	DULCES	AZUCAR	f	5.00	f	\N	{"familia_id": 31, "posiciones": {"pos_1": {"eje": "variedad", "valor": "Mascabo", "posicion": 1, "silencioso": false, "abreviatura": "MBO", "modo_display": "COMPLETO"}}, "familia_nombre": "Reposteria", "asistente_minutos": 5, "articulo_principal": "Azucar", "asistente_colaborador_id": 5}	Azucar	Azucar Mascabo x 5kg	f	f	1	31
AATGX5	7420.00	21.00	($)Pesos	Ninguno	t	CEREALES	AVENA	f	5.00	f	\N	{"familia_id": 27, "posiciones": {"pos_1": {"eje": "tratamiento", "valor": "Arrollada", "posicion": 1, "silencioso": false, "abreviatura": "ALLDA", "modo_display": "ABREVIADO"}, "pos_2": {"eje": "conformacion", "valor": "Gruesa", "posicion": 2, "silencioso": false, "abreviatura": "GSA", "modo_display": "COMPLETO"}}, "familia_nombre": "Cereales", "articulo_principal": "Avena", "silencioso_principal": false, "modo_display_principal": "COMPLETO"}	Avena	Avena ALLDA Gruesa x 5kg	f	f	1	27
ADX2K	16420.00	21.00	($)Pesos	Ninguno	t	DESHIDRATADOS	ARANDANOS	f	2.00	f	\N	{"familia_id": 26, "posiciones": {"pos_1": {"eje": "variedad", "valor": "Arandanos", "posicion": 1, "silencioso": false, "abreviatura": "ARDAS", "modo_display": "COMPLETO"}, "pos_2": {"eje": "conformacion", "valor": "Sin Semillas", "posicion": 2, "silencioso": true, "abreviatura": "SSLLAS", "modo_display": "COMPLETO"}, "pos_3": {"eje": "color", "valor": "Rojo", "posicion": 3, "silencioso": true, "abreviatura": "RJO", "modo_display": "COMPLETO"}, "pos_4": {"eje": "tratamiento", "valor": "Pasas", "posicion": 4, "silencioso": false, "abreviatura": "PSA", "modo_display": "COMPLETO"}}, "familia_nombre": "Frutas Disecadas", "asistente_minutos": 5, "articulo_principal": "Pasas de", "silencioso_principal": true, "modo_display_principal": "COMPLETO", "asistente_colaborador_id": 5}	Pasas de	Arandanos Pasas x 2kg	f	f	1	26
NMBEX1K	16390.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	NUECES	f	1.00	f	\N	{"familia_id": 1, "posiciones": {"pos_1": {"eje": "conformacion", "valor": "Peladas", "posicion": 1, "silencioso": true, "abreviatura": "PADA", "modo_display": "COMPLETO"}, "pos_2": {"eje": "variedad", "valor": "Chandler", "posicion": 2, "silencioso": false, "abreviatura": "CHLER", "modo_display": "ABREVIADO"}, "pos_4": {"eje": "tratamiento", "valor": "Mariposa", "posicion": 4, "silencioso": false, "abreviatura": "MPSA", "modo_display": "COMPLETO"}, "pos_5": {"eje": "color", "valor": "Extra light", "posicion": 5, "silencioso": false, "abreviatura": "EXLIGHT", "modo_display": "ABREVIADO"}}, "familia_nombre": "Frutos Secos", "asistente_minutos": 5, "articulo_principal": "Nuez", "asistente_colaborador_id": 5}	Nuez	Nuez CHLER Mariposa EXLIGHT x 1kg	f	f	1	1
AGRX10Q	120100.00	21.00	($)Pesos	Ninguno	t	\N	\N	f	10.00	f	\N	{"familia_id": 1, "posiciones": {"pos_1": {"eje": "conformacion", "valor": "Peladas", "posicion": 1, "silencioso": true, "abreviatura": "PADA", "modo_display": "COMPLETO"}, "pos_2": {"eje": "variedad", "valor": "Guara", "posicion": 2, "silencioso": false, "abreviatura": "GRA", "modo_display": "COMPLETO"}, "pos_4": {"eje": "tratamiento", "valor": "Ramillada", "posicion": 4, "silencioso": false, "abreviatura": "RLLADA", "modo_display": "ABREVIADO"}}, "familia_nombre": "Frutos Secos", "asistente_minutos": null, "articulo_principal": "ALMENDRA", "asistente_colaborador_id": null}	ALMENDRA	ALMENDRA Guara RLLADA x 10kg	f	f	1	1
SQRx25	141350.00	10.50	($)Pesos	Ninguno	t	SEMILLAS	QUINOA	f	25.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Semilla de Quinoa"}	Semilla de Quinoa	Semilla de Quinoa x 25kg	f	f	1	41
GDF5X500G	26000.00	21.00	($)Pesos	Ninguno	t	CEREALES	GRANOLA	f	2.50	t	GDFX500G	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Grana Flor"}	Grana Flor	Grana Flor 5 x 500g	t	f	5	41
GDFX200G	2300.00	21.00	($)Pesos	Ninguno	t	\N	\N	f	0.20	f	GFGNFX1	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Grana Flor"}	Grana Flor	Grana Flor x 200g	t	f	1	41
GDF10x500	52000.00	21.00	($)Pesos	Ninguno	t	CEREALES	GRANOLA	f	5.00	t	GDFX500G	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Grana Flor"}	Grana Flor	Grana Flor 10 x 500g	t	f	10	41
MPGDSX7	50000.00	21.00	($)Pesos	Ninguno	t	PRODUCCION DE INGREDIENTES	GRANOLA	f	7.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Mezcla Grana Sol"}	Mezcla Grana Sol	Mezcla Grana Sol x 7kg	f	f	1	41
MPGDFX6,9	50000.00	21.00	($)Pesos	Ninguno	t	\N	\N	f	6.90	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Mezcla Grana Flor"}	Mezcla Grana Flor	Mezcla Grana Flor x 6.9kg	f	f	1	41
MPX5	5000.00	21.00	($)Pesos	Ninguno	t	CEREALES	MAIZ	f	5.00	f	\N	{"familia_id": 27, "posiciones": {"pos_1": {"eje": "variedad", "valor": "Pisingallo", "posicion": 1, "silencioso": false, "abreviatura": "PIGLLO", "modo_display": "COMPLETO"}}, "familia_nombre": "Cereales", "asistente_minutos": 5, "articulo_principal": "Maiz", "silencioso_principal": false, "modo_display_principal": "COMPLETO", "asistente_colaborador_id": 5}	Maiz	Maiz Pisingallo x 5kg	f	f	1	27
AAIx5	6152.00	21.00	($)Pesos	Ninguno	t	\N	\N	f	5.00	f	\N	{"familia_id": 27, "posiciones": {"pos_1": {"eje": "tratamiento", "valor": "Arrollada", "posicion": 1, "silencioso": false, "abreviatura": "ALLDA", "modo_display": "ABREVIADO"}, "pos_2": {"eje": "conformacion", "valor": "Instantanea", "posicion": 2, "silencioso": false, "abreviatura": "ITNEA", "modo_display": "COMPLETO"}}, "familia_nombre": "Cereales", "asistente_minutos": 5, "articulo_principal": "Avena", "silencioso_principal": false, "modo_display_principal": "COMPLETO", "asistente_colaborador_id": 5}	Avena	Avena ALLDA Instantanea x 5kg	f	f	1	27
CHBx2	14158.00	21.00	($)Pesos	Ninguno	t	DESHIDRATADOS	BANANA	f	2.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Chip Banana"}	Chip Banana	Chip Banana x 2kg	f	f	1	41
APx2	50540.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	AVELLANAS	f	2.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Avellanas"}	Avellanas	Avellanas.PADA x 2kg	f	f	1	41
SKU-TEST-29762	0.00	21.00	($)Pesos	Ninguno	f	\N	\N	f	\N	f	\N	{"familia_id": 41}	Articulo Test Reasignacion	\N	f	f	1	41
NCC34/36X10	48650.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	NUECES	f	10.00	f	\N	{"familia_id": 1, "posiciones": {"pos_1": {"eje": "conformacion", "valor": "Con cascara", "posicion": 1, "silencioso": false, "abreviatura": "C/CAS", "modo_display": "COMPLETO"}, "pos_2": {"eje": "variedad", "valor": "Chandler", "posicion": 2, "silencioso": false, "abreviatura": "CHLER", "modo_display": "ABREVIADO"}, "pos_3": {"eje": "calibre", "valor": "34 - 36", "posicion": 3, "silencioso": false, "abreviatura": "34/36", "modo_display": "ABREVIADO"}}, "familia_nombre": "Frutos Secos", "asistente_minutos": null, "articulo_principal": "Nuez", "silencioso_principal": false, "modo_display_principal": "COMPLETO", "asistente_colaborador_id": null}	Nuez	Nuez Con cascara CHLER 34/36 x 10kg	f	f	1	1
NMECHAM10X200G	35000.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	NUECES	f	2.00	t	NMECHAMX200G	{"familia_id": 1, "posiciones": {"pos_1": {"eje": "conformacion", "valor": "Peladas", "posicion": 1, "silencioso": true, "abreviatura": "PADA", "modo_display": "COMPLETO"}, "pos_2": {"eje": "variedad", "valor": "Chandler", "posicion": 2, "silencioso": false, "abreviatura": "CHLER", "modo_display": "ABREVIADO"}, "pos_4": {"eje": "tratamiento", "valor": "Mariposa", "posicion": 4, "silencioso": false, "abreviatura": "MPSA", "modo_display": "COMPLETO"}, "pos_5": {"eje": "color", "valor": "Extra light", "posicion": 5, "silencioso": false, "abreviatura": "EXLIGHT", "modo_display": "ABREVIADO"}}, "familia_nombre": "Frutos Secos", "articulo_principal": "Nuez", "silencioso_principal": false, "modo_display_principal": "COMPLETO"}	Nuez	Nuez CHLER Mariposa EXLIGHT 10 x 200g	t	f	10	1
AAIx30	36912.00	21.00	($)Pesos	Ninguno	t	CEREALES	AVENA	f	30.00	f	\N	{"familia_id": 27, "posiciones": {"pos_1": {"eje": "tratamiento", "valor": "Arrollada", "posicion": 1, "silencioso": false, "abreviatura": "ALLDA", "modo_display": "ABREVIADO"}, "pos_2": {"eje": "conformacion", "valor": "Instantanea", "posicion": 2, "silencioso": false, "abreviatura": "ITNEA", "modo_display": "COMPLETO"}}, "familia_nombre": "Cereales", "asistente_minutos": null, "articulo_principal": "Avena", "silencioso_principal": false, "modo_display_principal": "COMPLETO", "asistente_colaborador_id": null}	Avena	Avena ALLDA Instantanea x 30kg	f	f	1	27
NCC34/36X5	24325.00	21.00	($)Pesos	Ninguno	t	\N	\N	f	5.00	f	\N	{"familia_id": 1, "posiciones": {"pos_1": {"eje": "conformacion", "valor": "Con cascara", "posicion": 1, "silencioso": false, "abreviatura": "C/CAS", "modo_display": "COMPLETO"}, "pos_2": {"eje": "variedad", "valor": "Chandler", "posicion": 2, "silencioso": false, "abreviatura": "CHLER", "modo_display": "ABREVIADO"}, "pos_3": {"eje": "calibre", "valor": "34 - 36", "posicion": 3, "silencioso": false, "abreviatura": "34/36", "modo_display": "ABREVIADO"}}, "familia_nombre": "Frutos Secos", "asistente_minutos": 5, "articulo_principal": "Nuez", "silencioso_principal": false, "modo_display_principal": "COMPLETO", "asistente_colaborador_id": 5}	Nuez	Nuez Con cascara CHLER 34/36 x 5kg	f	f	1	1
AGPX10Q	116400.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	ALMENDRAS	f	10.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Almendra"}	Almendra	Almendra.GRA.PTDA x 10kg	f	f	1	41
SAAX1	8400.00	10.50	($)Pesos	Ninguno	t	\N	\N	f	1.00	f	\N	{"familia_id": 2, "posiciones": {"pos_1": {"eje": "color", "valor": "Azul", "posicion": 1, "silencioso": false, "abreviatura": "AUL", "modo_display": "COMPLETO"}}, "familia_nombre": "Semillas", "asistente_minutos": 5, "articulo_principal": "Amapola", "silencioso_principal": false, "modo_display_principal": "COMPLETO", "asistente_colaborador_id": 5}	Amapola	Amapola Azul x 1kg	f	f	1	2
SZAAX1	8248.00	10.50	($)Pesos	Ninguno	t	SEMILLAS	ZAPALLO	f	1.00	f	SZAAX25	{"familia_id": 2, "posiciones": {"pos_1": {"eje": "color", "valor": "Verde", "posicion": 1, "silencioso": true, "abreviatura": "VDE", "modo_display": "COMPLETO"}, "pos_2": {"eje": "conformacion", "valor": "Doble A", "posicion": 2, "silencioso": false, "abreviatura": "AA", "modo_display": "ABREVIADO"}}, "familia_nombre": "Semillas", "asistente_minutos": 5, "articulo_principal": "Zapallo", "silencioso_principal": false, "modo_display_principal": "COMPLETO", "asistente_colaborador_id": 5}	Zapallo	Zapallo AA x 1kg	f	f	1	2
MRSSGx5	9000.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	MANI	f	5.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Mani"}	Mani	Mani.RELDO.TOTDO x 5kg	f	f	1	41
DACCDNX5	28750.00	21.00	($)Pesos	Ninguno	t	FRUTAS DISECADAS	DATILES	f	5.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Datil"}	Datil	Datil.AGIA.DGET.C/ZO x 5kg	f	f	1	41
EMB-7XKJBT	1056.88	21.00	($)Pesos	Ninguno	t	\N	\N	f	0.00	f	EMB-POIULR	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "CAJA MICRO M/M"}	CAJA MICRO M/M	CAJA MICRO M/M.IDP.PKU x 4 unidades	f	t	1	41
EMB-2WG4XI	1743.36	21.00	($)Pesos	Ninguno	t	INSUMOS	BOLSITA	f	1.00	f	EMB-W2DGA9	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "BOLSA 40 MIC"}	BOLSA 40 MIC	BOLSA 40 MIC.IDP.PKU.XXX x 96 unidades	f	t	96	41
MSEGx5	16300.00	21.00	($)Pesos	Ninguno	t	SEMILLAS	MIX	f	5.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Semillas"}	Semillas	Semillas.MIX x 5kg	f	f	1	41
ATx5	82500.00	21.00	($)Pesos	Ninguno	t	\N	\N	f	5.00	f	\N	{"familia_id": 1, "posiciones": {"pos_1": {"eje": "conformacion", "valor": "Peladas", "posicion": 1, "silencioso": true, "abreviatura": "PADA", "modo_display": "COMPLETO"}, "pos_2": {"eje": "variedad", "valor": "Non Pareil", "posicion": 2, "silencioso": true, "abreviatura": "NP", "modo_display": "COMPLETO"}, "pos_3": {"eje": "calibre", "valor": "27/30", "posicion": 3, "silencioso": true, "abreviatura": "27/30", "modo_display": "COMPLETO"}, "pos_4": {"eje": "tratamiento", "valor": "Tostado", "posicion": 4, "silencioso": false, "abreviatura": "TOTDO", "modo_display": "COMPLETO"}}, "familia_nombre": "Frutos Secos", "articulo_principal": "ALMENDRA", "silencioso_principal": false, "modo_display_principal": "COMPLETO"}	ALMENDRA	ALMENDRA Tostado x 5kg	f	f	1	1
MS10X300G	23574.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	MIX	f	3.00	t	MSX300G	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Mix Salado"}	Mix Salado	Mix Salado 10 x 300g	t	f	10	41
MFSTx300	3150.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	MIX	f	0.30	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Mix Frutos Secos"}	Mix Frutos Secos	Mix Frutos Secos.TRPCAL x 300g	t	f	1	41
MSX300G	2357.40	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	MIX	f	0.30	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Mix Salado"}	Mix Salado	Mix Salado x 300g	t	f	1	41
SZAAX25	206200.00	10.50	($)Pesos	Ninguno	t	SEMILLAS	ZAPALLO	f	25.00	f	\N	{"familia_id": 2, "posiciones": {"pos_1": {"eje": "color", "valor": "Verde", "posicion": 1, "silencioso": true, "abreviatura": "VDE", "modo_display": "COMPLETO"}, "pos_2": {"eje": "conformacion", "valor": "Doble A", "posicion": 2, "silencioso": false, "abreviatura": "AA", "modo_display": "ABREVIADO"}}, "familia_nombre": "Semillas", "asistente_minutos": null, "articulo_principal": "Zapallo", "silencioso_principal": false, "modo_display_principal": "COMPLETO", "asistente_colaborador_id": null}	Zapallo	Zapallo AA x 25kg	f	f	1	2
GDFX1	10400.00	21.00	($)Pesos	Ninguno	t	CEREALES	GRANOLA	f	1.00	f	GFGNFX1	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Grana Flor"}	Grana Flor	Grana Flor x 1kg	f	f	1	41
BFX50G	0.00	21.00	($)Pesos	Ninguno	t	PRODUCCION DE INGREDIENTES	GRANOLA	f	1.00	t	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Barra Flor"}	Barra Flor	Barra Flor.IDP 20 x 50g	t	f	20	41
FGKx1K	21000.00	21.00	($)Pesos	Ninguno	t	FRUTAS GLASEADAS	KIWI	f	1.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Kiwi"}	Kiwi	Kiwi.GLSDO.RJAS x 1kg	f	f	1	41
EMB-7A3E5C	333.00	21.00	($)Pesos	Ninguno	t	FRUTAS GLASEADAS	KIWI	f	10.00	t	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Kiwi"}	Kiwi	Kiwi.GLSDO.RJAS 10 x 1kg	f	f	1	41
M6x1	27000.00	21.00	($)Pesos	Ninguno	t	DULCES	MIEL	f	6.00	t	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Miel"}	Miel	Miel 6 x 1kg	f	f	1	41
GDF5x1	52000.00	21.00	($)Pesos	Ninguno	t	CEREALES	GRANOLA	f	5.00	t	GFGNFX1	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Grana Flor"}	Grana Flor	Grana Flor 5 x 1kg	f	f	5	41
GSGNFX1	50000.00	21.00	($)Pesos	Ninguno	t	PRODUCCION DE INGREDIENTES	GRANOLA	f	1.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Grana Sol"}	Grana Sol	Grana Sol.GNEL.MIX x 1kg	f	f	1	41
GDS10x500	39500.00	21.00	($)Pesos	Ninguno	t	\N	\N	f	5.00	t	GSX500G	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Grana Sol"}	Grana Sol	Grana Sol 10 x 500g	t	f	10	41
GSX500G	3950.00	21.00	($)Pesos	Ninguno	t	CEREALES	GRANOLA	f	0.50	f	GSGNFX1	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Grana Sol"}	Grana Sol	Grana Sol x 500g	t	f	1	41
GS5X1	39500.00	21.00	($)Pesos	Ninguno	t	CEREALES	GRANOLA	f	5.00	t	GSGNFX1	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Grana Sol"}	Grana Sol	Grana Sol 5 x 1kg	f	f	5	41
MCVX20	52440.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	MANI	f	20.00	f	\N	{"familia_id": 1, "posiciones": {"pos_1": {"eje": "conformacion", "valor": "Con cascara", "posicion": 1, "silencioso": false, "abreviatura": "C/CAS", "modo_display": "ABREVIADO"}, "pos_2": {"eje": "variedad", "valor": "Virginia", "posicion": 2, "silencioso": false, "abreviatura": "VGNA", "modo_display": "COMPLETO"}}, "familia_nombre": "Frutos Secos", "asistente_minutos": null, "articulo_principal": "Mani", "silencioso_principal": false, "modo_display_principal": "COMPLETO", "asistente_colaborador_id": null}	Mani	Mani C/CAS Virginia x 20kg	f	f	1	1
GSX1	7900.00	21.00	($)Pesos	Ninguno	t	CEREALES	GRANOLA	f	1.00	f	GSGNFX1	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Grana Sol"}	Grana Sol	Grana Sol x 1kg	f	f	1	41
NMECHX2	32780.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	NUECES	f	2.00	f	\N	{"familia_id": 1, "posiciones": {"pos_1": {"eje": "conformacion", "valor": "Peladas", "posicion": 1, "silencioso": true, "abreviatura": "PADA", "modo_display": "COMPLETO"}, "pos_2": {"eje": "variedad", "valor": "Chandler", "posicion": 2, "silencioso": false, "abreviatura": "CHLER", "modo_display": "ABREVIADO"}, "pos_4": {"eje": "tratamiento", "valor": "Mariposa", "posicion": 4, "silencioso": false, "abreviatura": "MPSA", "modo_display": "COMPLETO"}, "pos_5": {"eje": "color", "valor": "Extra light", "posicion": 5, "silencioso": false, "abreviatura": "EXLIGHT", "modo_display": "ABREVIADO"}}, "familia_nombre": "Frutos Secos", "asistente_minutos": 5, "articulo_principal": "Nuez", "silencioso_principal": false, "modo_display_principal": "COMPLETO", "asistente_colaborador_id": 5}	Nuez	Nuez CHLER Mariposa EXLIGHT x 2kg	f	f	1	1
EMB-67EZ0G	0.00	21.00	($)Pesos	Ninguno	t	ACEITES	COCO	f	4.00	f	\N	{"familia_id": 24, "posiciones": {"pos_1": {"eje": "variedad", "valor": "Neutro", "posicion": 1, "silencioso": false, "abreviatura": "NTRO", "modo_display": "ABREVIADO"}}, "familia_nombre": "Aceites", "asistente_minutos": null, "articulo_principal": "Aceite de", "codigo_barras_local": "9589768550", "asistente_colaborador_id": null}	Aceite de	Aceite de NTRO x 4kg	f	f	1	24
MFSSOXK	0.00	21.00	($)Pesos	Ninguno	t	PRODUCCION DE INGREDIENTES	MIX	f	1.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Mix Frutos Secos"}	Mix Frutos Secos	Mix Frutos Secos.SINPSAS.GNEL x 1kg	f	f	1	41
GS10X200G	18000.00	21.00	($)Pesos	Ninguno	t	\N	\N	f	2.00	t	GSX200G	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Grana Sol"}	Grana Sol	Grana Sol 10 x 200g	t	f	10	41
PFx10L	33200.00	21.00	($)Pesos	Ninguno	t	FRUTAS DISECADAS	PASA NEGRA	f	10.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Pasa Negra"}	Pasa Negra	Pasa Negra.FLME.SSLLA x 10kg	f	f	1	41
BF24X50	22100.00	21.00	($)Pesos	Ninguno	t	CEREALES	GRANOLA	f	1.20	t	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Barra Flor"}	Barra Flor	Barra Flor 24 x 50g	t	f	1	41
MPBX25	40500.00	21.00	($)Pesos	Ninguno	t	CEREALES	MAIZ	f	25.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Maiz"}	Maiz	Maiz.PDO.BCO x 25kg	f	f	1	41
MPBX5	8100.00	21.00	($)Pesos	Ninguno	t	CEREALES	MAIZ	f	5.00	f	MPBX25	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Maiz"}	Maiz	Maiz.PDO.BCO x 5kg	f	f	1	41
PALUx5	14000.00	10.50	($)Pesos	Ninguno	t	LEGUMBRES	ALUBIA	f	5.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Poroto Alubia"}	Poroto Alubia	Poroto Alubia x 5kg	f	f	1	41
GS5X500G	19750.00	21.00	($)Pesos	Ninguno	t	CEREALES	GRANOLA	f	2.50	t	GSX500G	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Grana Sol"}	Grana Sol	Grana Sol 5 x 500g	t	f	5	41
CRx5	34430.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	COCO	f	5.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Coco Rallado"}	Coco Rallado	Coco Rallado x 5kg	f	f	1	41
MCVX2	5244.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	MANI	f	2.00	f	\N	{"familia_id": 1, "posiciones": {"pos_1": {"eje": "conformacion", "valor": "Con cascara", "posicion": 1, "silencioso": false, "abreviatura": "C/CAS", "modo_display": "ABREVIADO"}, "pos_2": {"eje": "variedad", "valor": "Virginia", "posicion": 2, "silencioso": false, "abreviatura": "VGNA", "modo_display": "COMPLETO"}}, "familia_nombre": "Frutos Secos", "asistente_minutos": 5, "articulo_principal": "Mani", "silencioso_principal": false, "modo_display_principal": "COMPLETO", "asistente_colaborador_id": 5}	Mani	Mani C/CAS Virginia x 2kg	f	f	1	1
MRSSGx25	45000.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	MANI	f	25.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Mani"}	Mani	Mani.RELDO.G/G x 25kg	f	f	1	41
PTSx2	50000.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	PISTACHO	f	2.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Pistacho"}	Pistacho	Pistacho.TOS Y SAL x 2kg	f	f	1	41
HASPx1	18000.00	21.00	($)Pesos	Ninguno	t	HARINAS	ALMENDRAS	f	1.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Harina de Almendras"}	Harina de Almendras	Harina de Almendras.SPIEL x 1kg	f	f	1	41
PRx2	14440.00	21.00	($)Pesos	Ninguno	t	FRUTAS DISECADAS	PASA RUBIA	f	2.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Pasa"}	Pasa	Pasa.RBIA x 2kg	f	f	1	41
EMB-MN4UM1	2.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	CASTAÑAS	f	22.68	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Castañas de Caju"}	Castañas de Caju	Castañas de Caju.ETRA.NRAL.W5 x 22.68kg	f	f	1	41
HSX1	20934.00	21.00	($)Pesos	Ninguno	t	DESHIDRATADOS	HONGOS	f	1.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Hongo"}	Hongo	Hongo.SCO.BTUS x 1kg	f	f	1	41
AATGX25	52000.00	21.00	($)Pesos	Ninguno	t	CEREALES	AVENA	f	25.00	f	\N	{"familia_id": 27, "posiciones": {"pos_1": {"eje": "tratamiento", "valor": "Arrollada", "posicion": 1, "silencioso": false, "abreviatura": "ALLDA", "modo_display": "ABREVIADO"}, "pos_2": {"eje": "conformacion", "valor": "Gruesa", "posicion": 2, "silencioso": false, "abreviatura": "GSA", "modo_display": "COMPLETO"}}, "familia_nombre": "Cereales", "articulo_principal": "Avena", "silencioso_principal": false, "modo_display_principal": "COMPLETO"}	Avena	Avena ALLDA Gruesa x 25kg	f	f	1	27
SNIX25	48500.00	10.50	($)Pesos	Ninguno	t	SEMILLAS	SESAMO	f	25.00	f	\N	{"familia_id": 2, "posiciones": {"pos_2": {"eje": "conformacion", "valor": "Integral", "posicion": 2, "silencioso": false, "abreviatura": "IGRAL", "modo_display": "COMPLETO"}}, "familia_nombre": "Semillas", "articulo_principal": "Sesamo", "silencioso_principal": false, "modo_display_principal": "COMPLETO"}	Sesamo	Sesamo Integral x 25kg	f	f	1	2
AGPX2	23280.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	ALMENDRAS	f	2.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "ALMENDRA"}	ALMENDRA	ALMENDRA.GRA.PTDA x 2kg	f	f	1	41
EMB-8RO0YE	3260.00	21.00	($)Pesos	Ninguno	t	SEMILLAS	MIX	f	1.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Semillas"}	Semillas	Semillas.MIX x 1kg	f	f	1	41
PJx10	37600.00	21.00	($)Pesos	Ninguno	t	FRUTAS DISECADAS	PASA NEGRA	f	10.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Pasa"}	Pasa	Pasa.JBO x 10kg	f	f	1	41
CSCM110-132x5	33100.00	21.00	($)Pesos	Ninguno	t	FRUTAS DISECADAS	CIRUELAS	f	5.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Ciruel Bombon"}	Ciruel Bombon	Ciruel Bombon.110/132.MDIO x 5kg	f	f	1	41
CSC88-110x5R	35400.00	21.00	($)Pesos	Ninguno	t	FRUTAS DISECADAS	CIRUELAS	f	5.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Ciruel Bombon"}	Ciruel Bombon	Ciruel Bombon.88/110.GDE x 5kg	f	f	1	41
CCTX1	13160.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	CASTAÑAS	f	1.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Castañas de caju"}	Castañas de caju	Castañas de caju.TOTDO x 1kg	f	f	1	41
EMB-JK1OOX	3760.00	21.00	($)Pesos	Ninguno	t	FRUTAS DISECADAS	PASA NEGRA	f	1.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Pasa Negra"}	Pasa Negra	Pasa Negra.JBO.SSLLA x 1kg	f	f	1	41
CCW4x1k	11177.25	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	CASTAÑAS	f	1.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Castañas de caju"}	Castañas de caju	Castañas de caju.NRAL.ETRA x 1kg	f	f	1	41
GSCx5	6820.00	10.50	($)Pesos	Ninguno	t	LEGUMBRES	GARBANZO	f	5.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Garbanzo"}	Garbanzo	Garbanzo.SCO x 5kg	f	f	1	41
PRx10	72200.00	21.00	($)Pesos	Ninguno	t	\N	\N	f	10.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Pasa"}	Pasa	Pasa.RBIA x 10kg	f	f	1	41
MCTX5	45500.00	21.00	($)Pesos	Ninguno	t	\N	\N	f	5.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "mix"}	mix	mix.COLTR x 5kg	f	f	1	41
MFSPXK	0.00	21.00	($)Pesos	Ninguno	t	PRODUCCION DE INGREDIENTES	MIX	f	1.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "mix"}	mix	mix.GNEL.PIUN.MIX.PPMIX x 1kg	f	f	1	41
MSx2	15060.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	MIX	f	2.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Mix Salado"}	Mix Salado	Mix Salado x 2kg	f	f	1	41
MFSSPx2	24040.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	MIX	f	2.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Mix Frutos Secos"}	Mix Frutos Secos	Mix Frutos Secos.SINPSAS x 2kg	f	f	1	41
CCW4X5	55886.25	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	CASTAÑAS	f	5.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "asistente_minutos": null, "articulo_principal": "Castañas de caju", "asistente_colaborador_id": null}	Castañas de caju	Castañas de caju.NRAL.ETRA x 5kg	f	f	1	41
APN27/30X5	77400.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	ALMENDRAS	f	5.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "asistente_minutos": 5, "articulo_principal": "ALMENDRA", "asistente_colaborador_id": 5}	ALMENDRA	ALMENDRA.27/30.PEL/ENT.NP x 5kg	f	f	1	41
APN27/30X22,68	351086.40	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	ALMENDRAS	f	22.68	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Almendra"}	Almendra	Almendra.PEL/ENT.NP.27/30 x 22.68kg	f	f	1	41
MFSx2	14080.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	MIX	f	2.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Con Pasas"}	Con Pasas	Con Pasas.MIX x 2kg	f	f	1	41
CCW4X2	22354.50	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	CASTAÑAS	f	2.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Castañas de Caju"}	Castañas de Caju	Castañas de Caju.ETRA.NRAL x 2kg	f	f	1	41
MRSSGx2	3600.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	MANI	f	2.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Mani"}	Mani	Mani.RELDO x 2kg	f	f	1	41
CCDEX2	23460.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	COCO	f	2.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Coco Escamas"}	Coco Escamas	Coco Escamas x 2kg	f	f	1	41
CCDEX25	337962.96	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	COCO	f	25.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Coco Escamas"}	Coco Escamas	Coco Escamas x 25kg	f	f	1	41
GFGNFX1	500000.00	21.00	($)Pesos	Ninguno	t	PRODUCCION DE INGREDIENTES	GRANOLA	f	1.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Grana Flor"}	Grana Flor	Grana Flor.PL.GNEL.MIX x 1kg	f	f	1	41
GSX200G	1800.00	21.00	($)Pesos	Ninguno	t	CEREALES	GRANOLA	f	0.20	f	GSGNFX1	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Grana Sol"}	Grana Sol	Grana Sol x 200g	t	f	1	41
PJx2	7520.00	21.00	($)Pesos	Ninguno	t	FRUTAS DISECADAS	PASA NEGRA	f	2.00	f	\N	{"familia_id": 41, "posiciones": {}, "familia_nombre": "General / Sin Clasificar", "articulo_principal": "Pasa Negra"}	Pasa Negra	Pasa Negra.JBO x 2kg	f	f	1	41
SNx1	7410.00	10.50	($)Pesos	Ninguno	t	SEMILLAS	SESAMO	f	1.00	f	\N	{"familia_id": 2, "posiciones": {"pos_1": {"eje": "color", "valor": "Blanco", "posicion": 1, "silencioso": false, "abreviatura": "BCO", "modo_display": "COMPLETO"}}, "familia_nombre": "Semillas", "asistente_minutos": 5, "articulo_principal": "Sesamo", "asistente_colaborador_id": 5}	Sesamo	Sesamo Blanco x 1kg	f	f	1	2
NMECHAMX200G	3500.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	NUECES	t	0.20	f	\N	{"familia_id": 1, "posiciones": {"pos_1": {"eje": "conformacion", "valor": "Peladas", "posicion": 1, "silencioso": false, "abreviatura": "PADA", "modo_display": "COMPLETO"}, "pos_2": {"eje": "variedad", "valor": "Chandler", "posicion": 2, "silencioso": false, "abreviatura": "CHLER", "modo_display": "COMPLETO"}, "pos_4": {"eje": "tratamiento", "valor": "Mariposa", "posicion": 4, "silencioso": false, "abreviatura": "MPSA", "modo_display": "COMPLETO"}, "pos_5": {"eje": "color", "valor": "Extra light", "posicion": 5, "silencioso": false, "abreviatura": "EXLIGHT", "modo_display": "COMPLETO"}}, "familia_nombre": "Frutos Secos", "asistente_minutos": 3, "articulo_principal": "Nuez", "asistente_colaborador_id": 5}	Nuez	Nuez Peladas Chandler Mariposa Extra light x 200g	t	f	1	1
NMELCHx5	61500.00	21.00	($)Pesos	Ninguno	t	FRUTOS SECOS	NUECES	f	5.00	f	\N	{"familia_id": 1, "posiciones": {"pos_1": {"eje": "conformacion", "valor": "Peladas", "posicion": 1, "silencioso": true, "abreviatura": "PADA", "modo_display": "COMPLETO"}, "pos_2": {"eje": "variedad", "valor": "Chandler", "posicion": 2, "silencioso": false, "abreviatura": "CHLER", "modo_display": "ABREVIADO"}, "pos_4": {"eje": "tratamiento", "valor": "Mariposa", "posicion": 4, "silencioso": false, "abreviatura": "MPSA", "modo_display": "COMPLETO"}, "pos_5": {"eje": "color", "valor": "Extra light", "posicion": 5, "silencioso": false, "abreviatura": "EXLIGHT", "modo_display": "ABREVIADO"}}, "familia_nombre": "Frutos Secos", "asistente_minutos": 5, "articulo_principal": "Nuez", "asistente_colaborador_id": 5}	Nuez	Nuez CHLER Mariposa EXLIGHT x 5kg	f	f	1	1
\.


--
-- Data for Name: receta_articulos; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.receta_articulos (id, receta_id, articulo_numero, cantidad) FROM stdin;
34	209	MPGDFX6,9	1.00
40	208	AGPX10Q	1.00
41	214	MPGDSX7	1.00
58	228	APC27/30x10	1.00
59	250	CCW4X22,68	1.00
60	219	CCW4X22,68	1.00
61	227	APN27/30X22,68	1.00
62	194	MPB	1.00
\.


--
-- Data for Name: recetas; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.recetas (id, articulo_numero, descripcion, fecha_creacion, articulo_sugerido_numero, enlazado_externo) FROM stdin;
115	MFSTx2		2025-06-19 11:01:31.848398	\N	f
9	NCELCHx6		2025-05-26 20:41:48.459453	\N	f
10	undefined		2025-05-26 20:58:37.690114	\N	f
150	PTSX150G	Receta de Búnker para Pistacho.TOS Y SAL.C/CAS x 150g	2025-06-30 14:03:36.249117	\N	f
152	MFSPx300	Receta de Búnker para Mix Frutos Secos.PIUN x 300g	2025-06-30 15:42:36.648919	MFSPXK	f
31	TEST001	Prueba con cantidad string	2025-05-28 03:11:52.467401	\N	f
33	TEST002	Prueba nombre largo	2025-05-28 03:12:58.164813	\N	f
34	TEST003	Prueba duplicado	2025-05-28 03:13:23.556037	\N	f
83	MSX300G	Receta de Búnker para Mix Salado.G/CH x 300g	2025-06-08 08:59:43.905356	MSXK	f
132	CCTSx5		2025-06-25 13:52:11.037893	\N	f
67	MFSx5		2025-06-01 01:27:55.857425	MFSXK	f
41	APN27/30X5		2025-05-28 04:11:26.934263	\N	f
98	APX5		2025-06-11 10:06:08.973429	\N	f
145	MFBx2,5		2025-06-26 10:44:43.03448	\N	f
5	CCDEX2		2025-05-24 19:02:26.281235	\N	f
99	GLX2		2025-06-11 15:32:12.982212	\N	f
66	AATFx5		2025-05-31 17:02:49.526566	\N	f
53	MFSPx5		2025-05-29 23:25:27.371019	MFSPXK	f
114	MFSSPx2		2025-06-19 10:50:04.009634	MFSSOXK	f
40	ANX5		2025-05-28 04:02:46.984433	\N	f
162	GDFX500G	Receta de Búnker para Grana Flor x 500g	2025-07-04 11:50:49.642902	\N	f
142	MFMMx5		2025-06-26 10:29:55.737333	\N	f
144	MFQx5		2025-06-26 10:36:53.073259	\N	f
146	MFBX5		2025-06-26 10:45:00.706941	\N	f
127	SGx5		2025-06-23 14:43:52.228927	\N	f
187	MFST10x300		2025-07-24 16:26:20.996548	\N	f
76	HDGX5		2025-06-06 06:52:05.348971	\N	f
158	SQx5	Receta de Búnker para Semilla de Quinoa x 5kg	2025-07-02 09:38:22.561737	\N	f
183	MRSx5		2025-07-24 11:08:16.247165	\N	f
81	TSEx3		2025-06-07 19:50:19.660334	\N	f
77	PRx2	Receta de Búnker para Pasa.RBIA x 2kg	2025-06-06 11:30:34.145095	\N	f
79	CRx2		2025-06-07 08:47:26.496865	\N	f
90	GLX5		2025-06-10 14:48:32.635889	\N	f
106	SLX2		2025-06-13 09:29:06.5282	\N	f
107	SLX5		2025-06-13 09:30:23.040872	\N	f
46	ADX2K		2025-05-29 00:34:58.203525	\N	f
140	GFGNFX1	Receta de GFGNFX1	2025-06-25 16:28:25.392368	\N	f
13	AJPX1		2025-05-26 23:21:47.949441	\N	f
75	HAx5		2025-06-05 00:32:06.715247	\N	f
18	NCC36+X5		2025-05-27 21:33:19.870815	\N	f
84	AGPX2	Receta de Búnker para ALMENDRA.GRA.PTDA x 2kg	2025-06-09 00:48:06.199268	\N	f
6	CCW4X2	Receta de Búnker para Castañas de Caju.ETRA.NRAL x 2kg	2025-05-24 19:43:06.614389	\N	f
8	ATySx2		2025-05-26 11:12:56.038478	\N	f
24	ATySx5		2025-05-28 00:39:56.257305	\N	f
82	MSx2		2025-06-07 21:20:50.439339	\N	f
15	ATx2		2025-05-27 19:48:16.878608	\N	f
73	MSx5	Receta de Búnker para Mix Salado x 5kg	2025-06-02 11:13:47.566172	MSXK	f
2	ABX5		2025-05-24 18:06:19.616883	\N	f
14	ACAx5		2025-05-27 01:39:19.839255	\N	f
17	APSx 5		2025-05-27 21:31:40.223702	\N	f
3	AINTX5		2025-05-24 18:07:43.31916	\N	f
20	AYX5		2025-05-27 23:39:34.781955	\N	f
192	MFX5		2025-07-30 10:47:14.594169	\N	f
68	MFSPX2		2025-06-01 01:38:58.358444	MFSPXK	f
193	MFSTXK		2025-07-31 13:38:23.048504	\N	f
86	NMELCHx5	Receta de Búnker para Nuez.MPSA.EXGHT x 5kg	2025-06-09 00:52:42.205175	\N	f
151	CHNAx1		2025-06-30 15:14:50.077497	\N	f
117	APNC27/30x10		2025-06-21 17:54:31.042501	\N	f
22	CCTX5		2025-05-28 00:24:15.496522	\N	f
16	ADX5K		2025-05-27 21:18:03.258609	\N	f
71	MFSX300G		2025-06-01 09:26:32.4061	MFSXK	f
176	APN1x1	Receta de Búnker para Almendra.NP.27/30.PEL/ENT x 1kg	2025-07-21 16:55:18.379881	\N	f
159	MFSTx5		2025-07-02 13:03:13.259572	\N	f
102	APFX2K		2025-06-13 09:22:58.522744	\N	f
177	APx1K		2025-07-21 17:25:53.01708	\N	f
78	PPCXK		2025-06-06 11:33:29.561394	\N	f
87	MFSBKx5		2025-06-09 13:30:05.860805	MFSBKXK	f
91	LRTX5		2025-06-10 14:51:10.221114	\N	f
154	NPMx5		2025-07-01 15:18:23.430489	\N	f
155	MRSx2		2025-07-01 15:21:43.672561	\N	f
134	MPGDSX7	Receta de Búnker para Mezcla Grana Sol x 7kg	2025-06-25 14:50:05.402784	\N	f
101	PPX5	Receta de Búnker para Porotos Pallares x 5kg	2025-06-12 10:09:20.65168	\N	f
72	APFX5		2025-06-01 21:36:39.232498	\N	f
125	NPM		2025-06-23 11:46:32.116358	\N	f
94	APGX2		2025-06-10 17:27:38.032551	\N	f
95	APGX5		2025-06-11 10:00:49.678775	\N	f
27	SNIX2		2025-05-28 01:20:05.632038	\N	f
149	AAIx5	Receta de Búnker para Avena ALLDA Instantanea x 5kg	2025-06-30 04:37:59.279646	\N	f
157	SQRx25		2025-07-02 09:37:22.834712	\N	f
69	APN25/27X150G	Receta de Búnker para Almendra.PEL/ENT.NP x 150g	2025-06-01 08:38:48.138538	\N	f
28	AP9-11X5		2025-05-28 01:31:18.015159	\N	f
85	AMx5	Receta de Búnker para Azucar Mascabo x 5kg	2025-06-09 00:51:22.040258	\N	f
160	MCR50/60X5		2025-07-04 10:12:39.646933	\N	f
161	PNx5		2025-07-04 10:14:02.852374	\N	f
113	ATySx150		2025-06-18 17:11:15.673036	\N	f
88	MFSAFx5		2025-06-09 15:15:55.842106	MFSAFXK	f
136	GSGNFX1	Receta de GSGNFX1	2025-06-25 15:34:04.790759	\N	f
80	SZAAX1		2025-06-07 08:50:30.181269	\N	f
148	GDFX1		2025-06-27 14:41:44.954837	\N	f
54	MFSx2		2025-05-30 14:00:28.051672	MFSXK	f
104	SCHx5		2025-06-13 09:27:48.838606	\N	f
103	AATGX5		2025-06-13 09:26:30.593346	\N	f
21	APx2		2025-05-28 00:22:29.947977	\N	f
173	SCHx2M		2025-07-18 09:46:42.412342	\N	f
181	MRSSGx2		2025-07-23 14:05:10.813996	\N	f
26	CCTX2		2025-05-28 01:15:51.963368	\N	f
171	LDA12X1L		2025-07-17 12:11:27.584448	\N	f
172	LDC12X1L		2025-07-17 12:11:43.346072	\N	f
105	SCHx2		2025-06-13 09:28:30.75112	\N	f
174	SCHx5M		2025-07-18 09:46:55.827928	\N	f
156	MRSSGx5	Receta de Búnker para Mani.RELDO.TOTDO x 5kg	2025-07-01 15:39:00.977205	\N	f
178	LDAX1L		2025-07-22 07:15:41.987731	\N	f
182	NMLX5		2025-07-24 10:21:30.890911	\N	f
168	PTSx2		2025-07-14 15:12:48.989648	\N	f
11	ATx5		2025-05-26 21:24:43.590073	\N	f
70	MFS10X300G		2025-06-01 08:40:26.054151	\N	f
189	MFSP10X300		2025-07-24 16:28:59.749545	\N	f
74	CHBx2		2025-06-02 14:21:45.931099	\N	f
23	CCW4X5		2025-05-28 00:35:39.186215	\N	f
93	NMECHX2	Receta de Búnker para Nuez.EXGHT.MPSA x 2kg	2025-06-10 16:27:57.012569	\N	f
143	MFDQX2,5		2025-06-26 10:35:57.427154	\N	f
191	MFX2,5		2025-07-28 20:42:09.741017	\N	f
147	GSX500G	Receta de Búnker para Grana Sol x 500g	2025-06-26 15:57:50.274908	\N	f
92	LX5B	Receta de Búnker para Lentejon.CDA.N2 x 5kg	2025-06-10 15:00:21.897257	\N	f
180	PTSx5		2025-07-22 15:51:31.094319	\N	f
96	MCVX5	Receta de Búnker para Mani con Cascara.VGNA x 5kg	2025-06-11 10:01:58.516107	\N	f
116	SBX5		2025-06-19 14:21:06.072381	\N	f
141	MFMMx2,5		2025-06-26 10:28:33.961991	\N	f
97	MCVX2		2025-06-11 10:03:09.835303	\N	f
235	SNx1	Receta de Búnker para Sesamo.NGRO x 1kg	2025-11-12 13:37:51.058408	\N	f
195	LNCNLx5		2025-08-04 13:29:21.685049	\N	f
196	HIOX5		2025-08-04 13:31:54.090151	\N	f
197	MFSXK		2025-08-04 15:30:12.879736	\N	f
198	MFSPXK		2025-08-04 18:14:09.01014	\N	f
204	MFSSOXK		2025-08-07 14:35:11.086704	\N	f
205	SBx1		2025-08-08 15:45:38.78904	\N	f
206	MCVX20		2025-08-10 18:44:32.503834	\N	f
226	ATX1		2025-10-22 17:29:04.314803	\N	f
210	HDMCX5		2025-08-13 08:43:03.235011	\N	f
274	MCTX300	Receta de Búnker para Mix Frutos Secos.COLTR x 300g	2026-05-07 14:23:22.815819	MCTXK	f
211	NCECAMX5		2025-08-14 15:59:04.870326	\N	f
212	MFSBKXK		2025-08-20 15:47:51.324235	\N	f
213	MFSAFXK		2025-08-20 15:48:42.05448	\N	f
225	MFSx1		2025-10-22 17:27:50.190586	MFSXK	f
268	MFSPX1		2026-04-20 16:41:12.923331	MFSPXK	f
236	GSCx5		2025-11-14 13:20:19.921741	\N	f
131	MFSTx300		2025-06-25 10:39:07.902862	MFSTXK	f
260	SNIX5	Receta de Búnker para Sesamo Integral x 5kg	2026-03-25 14:35:25.509788	\N	f
215	PPCX5		2025-09-04 13:58:22.474771	\N	f
216	SAAX5		2025-09-08 16:07:12.749394	\N	f
217	PSX300G		2025-09-09 13:20:04.708222	\N	f
220	HSX1	Receta de Búnker para Hongo.SCO.BTUS x 1kg	2025-09-23 13:41:15.048495	\N	f
201	SGx2		2025-08-06 18:30:42.771132	\N	f
199	MSXK		2025-08-04 18:25:24.128887	\N	f
209	GFGN		2025-08-11 14:04:17.872237	\N	f
200	ADPX200G		2025-08-06 17:58:40.258685	\N	f
221	FGAIRX2,5		2025-09-25 10:58:23.919692	\N	f
30	CRx5	Receta de Búnker para Coco Rallado x 5kg	2025-05-28 02:48:22.832954	\N	f
222	HSX5		2025-10-02 10:28:18.511403	\N	f
223	PSTX5		2025-10-08 10:15:36.147539	\N	f
229	ATYSX1		2025-10-30 17:23:22.050037	\N	f
230	CPPX1		2025-10-30 17:23:53.24575	\N	f
231	APN25/27X5		2025-11-01 09:32:42.875214	\N	f
233	APN25/27x2		2025-11-10 09:46:58.916652	\N	f
207	MCTXK	Receta de Búnker para Mix Frutos Secos.GNEL.COLTR x 1kg	2025-08-11 13:51:42.090016	\N	f
238	NC36+X10		2025-12-01 19:30:35.450687	\N	f
239	AGCX2,5		2025-12-03 20:49:36.762852	\N	f
277	MPX5		2026-05-20 14:03:34.164226	\N	f
208	APTSPGUPPM		2025-08-11 14:00:10.230726	\N	f
214	GSGN		2025-09-02 14:15:49.282903	\N	f
256	MSEGx5		2026-03-09 18:36:15.297305	\N	f
245	CPPX3		2025-12-22 02:34:21.005224	\N	f
247	NPMX1		2025-12-22 02:50:32.332332	\N	f
249	NCLLEX6		2025-12-22 22:11:19.715753	\N	f
251	APFX500G		2026-01-02 12:31:53.859578	\N	f
284	EMB-2WG4XI		2026-07-05 22:02:51.529631	\N	f
253	ADAX5		2026-02-13 13:10:05.346325	\N	f
254	PKX2		2026-02-19 14:42:38.919441	\N	f
255	QRX1		2026-03-06 14:03:18.521333	\N	f
258	DTX2		2026-03-11 14:12:18.586337	\N	f
259	APC25/27X5		2026-03-16 15:18:53.392117	\N	f
228	APTSPGUP		2025-10-24 16:43:07.60101	\N	f
261	DACCDNX5		2026-03-26 14:25:31.79324	\N	f
263	JDX1,5		2026-03-30 14:40:35.61567	\N	f
264	JDX3		2026-03-30 14:40:59.179216	\N	f
265	HDAX5		2026-03-30 15:49:46.969014	\N	f
266	APC25/27X2		2026-03-31 10:38:17.434389	\N	f
269	DACCDNX1		2026-04-21 07:52:07.712494	\N	f
270	PSx1		2026-04-21 11:16:00.28447	\N	f
271	ARBX5		2026-04-22 13:39:54.226453	\N	f
250	CCTGXKUP		2025-12-23 01:20:31.028612	\N	f
219	CCTSGXKUP		2025-09-19 16:28:52.907731	\N	f
227	APTPGUP		2025-10-23 16:33:16.214483	\N	f
285	EMB-7XKJBT		2026-07-06 00:15:20.872407	\N	f
272	AMx1		2026-04-25 18:29:19.65943	\N	f
273	8784896325		2026-04-27 14:40:36.807749	\N	f
232	PALUx5	Receta de Búnker para Poroto Alubia x 5kg	2025-11-09 21:36:25.591029	\N	f
278	MPBX5		2026-05-20 14:45:04.694678	\N	f
252	AGPX5		2026-01-25 16:28:23.246868	\N	f
262	APNx2		2026-03-26 20:38:08.105027	\N	f
240	NMBEX1K		2025-12-10 21:20:42.162581	\N	f
257	MFSTx1		2026-03-10 15:52:33.658999	\N	f
234	MFSSPx1		2025-11-12 13:36:17.894285	MFSSOXK	f
279	DIMx1		2026-06-10 15:54:13.595433	\N	f
224	CCW4x1k		2025-10-22 17:26:28.033654	\N	f
276	SNX5	Receta de Búnker para Sesamo.NGRO x 5kg	2026-05-12 15:24:31.459878	\N	f
194	BFXP		2025-08-02 18:21:25.184199	\N	f
19	CCTSx2B	Receta de Búnker para Castañas de caju.TOS Y SAL x 2kg	2025-05-27 23:28:35.147731	\N	f
286	LNX5	Receta de Búnker para Lentejas.NNAL x 5kg	2026-07-13 12:23:38.62976	\N	f
291	APTPGXK	Receta de Búnker para Almendra.GNEL.TOTDO.NP x 1kg	2026-07-16 10:03:30.97996	\N	f
242	ATX150	Receta de Búnker para Almendra.TOTDO x 150g	2025-12-16 10:01:43.582343	\N	f
287	PAx5	Receta de Búnker para Poroto Adzuki x 5kg	2026-07-13 12:39:21.839193	\N	f
275	CCTX1	Receta de Búnker para Castañas de caju.TOTDO x 1kg	2026-05-08 12:12:18.634492	\N	f
288	EMB-JK1OOX	Receta de Búnker para Pasa Negra.JBO.SSLLA x 1kg	2026-07-13 19:21:44.515181	\N	f
108	HASPx1	Receta de Búnker para Harina de Almendras.SPIEL x 1kg	2025-06-13 22:33:50.925309	\N	f
237	NCBxK	Receta de Búnker para Nuez Cuarto.EXGHT.CHLER x 2kg	2025-11-17 13:01:06.220326	\N	f
289	EMB-LS1ILU	Receta de Búnker para Bolsas.40/50.PKU x 100 unidades	2026-07-14 12:39:46.64661	\N	f
100	MCTX5	Receta de Búnker para mix.GRMED.COLTR x 5kg	2025-06-12 09:48:47.75888	MCTXK	f
175	SZAAx5	Receta de Búnker para Semilla de Zapallo.AA x 5kg	2025-07-18 09:53:01.42672	\N	f
292	EMB-601GSR	Receta de Búnker para Jengibre en Cubos x 1kg	2026-07-17 11:07:18.169862	\N	f
290	NMECHAMX200G	Receta de Búnker para NUEZ.MPSA.EXGHT x 200g	2026-07-14 17:10:01.734907	\N	f
153	BF24X50	Receta de Búnker para Barra Flor 24 x 50g	2025-07-01 14:26:34.537834	\N	f
139	MPGDFX6,9	Receta de Búnker para Mezcla Grana Flor x 6.9kg	2025-06-25 16:00:11.837285	\N	f
129	CCTSx150	Receta de Búnker para Castañas de caju.TOS Y SAL x 150g	2025-06-24 10:35:45.886976	\N	f
130	GSX1	Receta de Búnker para Grana Sol x 1kg	2025-06-24 16:17:10.413871	\N	f
126	MFSSPx5	Receta de Búnker para Mix Frutos Secos.SINPSAS x 5kg	2025-06-23 11:47:48.419284	MFSSOXK	f
89	MPB	Receta externa calculada dinámicamente desde relación de producción	2025-06-09 17:05:23.083824	\N	f
137	GSX200G	Receta de Búnker para Grana Sol x 200g	2025-06-25 15:37:37.741005	\N	f
111	GDFX200G	Receta de Búnker para Grana Flor x 200g	2025-06-17 11:09:25.545472	GFGNFX1	f
203	PJx2	Receta de Búnker para Pasa Negra.JBO x 2kg	2025-08-07 14:24:53.992019	\N	f
243	NCC34/36X5		2025-12-16 20:50:32.417206	\N	f
202	SAAX1	Receta de Búnker para Amapola Azul x 1kg	2025-08-06 19:09:00.258836	\N	f
\.


--
-- Name: receta_articulos_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.receta_articulos_id_seq', 62, true);


--
-- Name: recetas_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.recetas_id_seq', 292, true);


--
-- Name: bunker_articulos bunker_articulos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bunker_articulos
    ADD CONSTRAINT bunker_articulos_pkey PRIMARY KEY (articulo_id);


--
-- Name: receta_articulos receta_articulos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.receta_articulos
    ADD CONSTRAINT receta_articulos_pkey PRIMARY KEY (id);


--
-- Name: recetas recetas_articulo_numero_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recetas
    ADD CONSTRAINT recetas_articulo_numero_key UNIQUE (articulo_numero);


--
-- Name: recetas recetas_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recetas
    ADD CONSTRAINT recetas_pkey PRIMARY KEY (id);


--
-- Name: idx_bunker_articulos_familia_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bunker_articulos_familia_id ON public.bunker_articulos USING btree (familia_id);


--
-- Name: bunker_articulos bunker_articulos_familia_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bunker_articulos
    ADD CONSTRAINT bunker_articulos_familia_id_fkey FOREIGN KEY (familia_id) REFERENCES public.bunker_familias(id) ON DELETE SET NULL;


--
-- Name: receta_articulos receta_articulos_receta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.receta_articulos
    ADD CONSTRAINT receta_articulos_receta_id_fkey FOREIGN KEY (receta_id) REFERENCES public.recetas(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

