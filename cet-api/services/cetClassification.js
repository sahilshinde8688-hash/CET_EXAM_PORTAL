/**
 * cetClassification.js
 * --------------------
 * Intelligent MHT-CET classification for PDF-extracted questions.
 *
 * Runs as an extension of the existing PDF import pipeline (pdfImportService)
 * right after the question parser: every extracted question is classified into
 *   subject -> chapter -> topic -> sub-topic
 * against the Maharashtra CET / MHT-CET syllabus taxonomy below, and mapped to
 * CET question type, CET difficulty and CET relevance. Pure functions only —
 * no I/O — so the heuristics stay unit-testable (see test/cet-classification.test.js).
 *
 * Classification always leaves room for admin control: fields the engine cannot
 * detect reliably are returned empty ("Not Identified") instead of guessed, and
 * explicit metadata printed in the PDF ("Subject: Physics") always wins over
 * keyword inference.
 */

// ── CET classification vocabularies (shared with the admin UI) ──────────────

const QUESTION_TYPES = [
  'Conceptual',
  'Formula Based',
  'Numerical',
  'Application Based',
  'Multi-Concept',
  'Graph Based',
  'Diagram Based',
]

const CET_RELEVANCE_LEVELS = ['Highly Relevant', 'Relevant', 'Partially Relevant', 'Not Relevant']

const CET_DIFFICULTY_LEVELS = ['Easy', 'Moderate', 'Hard', 'Very Hard']

const CLASSIFICATION_SOURCES = ['pdf', 'rules', 'ai', 'manual']

// ── Syllabus taxonomy helpers ───────────────────────────────────────────────

/** 'a|b|c' -> ['a', 'b', 'c'] — compact keyword lists keep the taxonomy readable. */
const K = (s) => String(s || '').split('|').map((x) => x.trim().toLowerCase()).filter(Boolean)

/** Chapter: { keywords, topics } — a topic value is either a keyword string or { k, s }. */
const C = (keywords, topics) => ({ keywords: K(keywords), topics: topics || {} })

// ── MHT-CET syllabus map (Maharashtra Board XI + XII, PCM + PCB groups) ─────
//
// Structure: subject -> chapters -> topics -> sub-topics. Keyword quality beats
// quantity: entries are discriminative phrases that survive the text
// normaliser below (lowercase letters, digits, '^' and '/').

const CET_SYLLABUS = {
  Mathematics: C('mathematics|maths|math', {
    'Mathematical Logic': C('truth table|logic|statement|negation|conjunction|disjunction|implication|contrapositive|converse|tautology|contradiction|quantifier|switching circuit|boolean algebra|logical connective|compound statement', {
      'Statement & Truth Tables': 'statement|truth value|truth table|compound statement',
      'Logical Connectives': 'conjunction|disjunction|implication|negation|contraposector|contrapositive|converse|inverse statement',
      'Algebra of Statements': 'tautology|contradiction|duality principle|algebra of statements',
      'Boolean Algebra & Switching': 'boolean algebra|switching circuit|switches in series|switches in parallel',
    }),
    Matrices: C('matrix|matrices|square matrix|order of matrix|matrix method', {
      'Formation of Matrix': 'formation of matrix|construct a matrix|elements of matrix|order of the matrix',
      'Types of Matrices': 'symmetric matrix|skew symmetric|diagonal matrix|identity matrix|scalar matrix|triangular matrix|singular matrix|non singular matrix|zero matrix|null matrix|row matrix|column matrix|hermitian matrix|unit matrix',
      'Algebra of Matrices': 'addition of matrices|subtraction of matrices|scalar multiplication of matrix|equal matrices',
      'Product of Matrices': 'multiplication of matrices|product of matrices|matrix multiplication|multiply the matrices|pre multiply|post multiply|commutative product|associative law',
      'Transpose of a Matrix': 'transpose|transposed matrix|properties of transpose',
      'Adjoint': { k: 'adjoint|adj a|adjoint of a matrix|cofactor matrix', s: { 'Properties of Adjoint': 'properties of adjoint|adjoint of singular|adjoint of non singular' } },
      'Inverse of a Matrix': 'inverse of a matrix|inverse matrix|invertible matrix|inverse by elementary|elementary transformation|elementary row operations|rank of matrix',
      'Solution of Simultaneous Equations': 'matrix method|simultaneous equations by matrix|non homogeneous equations|homogeneous system|system of linear equations|crames rule|cramer s rule',
    }),
    Determinants: C('determinant|determinants|minor|cofactor|cramer s rule|crames rule', {
      'Minors & Cofactors': 'minor of an element|cofactor of an element|minors and cofactors',
      'Properties of Determinants': 'properties of determinant|two rows identical|rows and columns interchange|without expanding',
      'Expansion of Determinants': 'expand the determinant|expansion along|value of determinant|third order determinant|second order determinant',
      'Applications of Determinants': 'cramer s rule|crames rule|area of triangle using determinant|consistency of equations',
    }),
    'Trigonometric Functions': C('trigonometric|trigonometry|compound angle|multiple angle|submultiple angle|allied angles|radian|circular measure|general solution|principal solution|polar coordinates', {
      'Fundamental Identities': 'trigonometric identity|fundamental identities|pythagorean identity',
      'Compound Angles': 'compound angle|sum formula|difference formula|sin a plus b|cos a minus b|expansion of sin|expansion of cos|tan of sum',
      'Multiple & Submultiple Angles': 'multiple angle|submultiple angle|double angle|triple angle|half angle formula|sin 2a|cos 2a|tan 2a|cot 2a',
      'Factorization Formulae': 'factorization formula|sin c minus sin d|cos c plus cos d|sum to product|product to sum',
      'Solution of Triangles': 'sine rule|cosine rule|projection formula|napier analogy|solution of triangle|half angle formula of triangle|area of triangle in terms of',
      'Inverse Trigonometric Functions': 'inverse trigonometric|inverse sine|inverse cosine|inverse tangent|principal value branch|principal values of inverse|sin inverse|cos inverse|tan inverse|cosec inverse|sec inverse|cot inverse',
    }),
    'Straight Line': C('straight line|equation of line|slope of line|inclination of line|collinear points|concurrent lines|locus', {
      'Equation of a Line': 'equation of line|slope intercept|point slope form|two point form|intercept form|normal form|equation of straight line',
      'Angle Between Lines': 'angle between two lines|acute angle between|perpendicular lines|parallel lines|value of k for which',
      'Distance & Foot of Perpendicular': 'distance of a point from a line|foot of perpendicular|distance between parallel lines|length of perpendicular',
      'Locus': 'locus|equation of locus|point moves|set of points',
      'Family of Lines': 'family of lines|passing through the point of intersection',
    }),
    Circle: C('circle|centre of circle|radius of circle|tangent to circle|chord of circle|equation of circle', {
      'Equation of a Circle': 'equation of circle|standard form of circle|general equation of circle|centre and radius of circle|diameter form|parametric form of circle',
      'Tangent & Normal to a Circle': 'tangent to the circle|length of tangent|tangent from a point|normal to the circle|director circle',
      'Relative Position of Two Circles': 'two circles touch|common chord|radical axis|orthogonal circles|angle of intersection of circles',
    }),
    Conics: C('parabola|ellipse|hyperbola|focus|directrix|eccentricity|latus rectum|conic|conic section', {
      'Parabola': 'parabola|vertex of parabola|focus of parabola|latus rectum of parabola|axis of parabola',
      'Ellipse': 'ellipse|major axis|minor axis|foci of ellipse|eccentricity of ellipse|latus rectum of ellipse|auxiliary circle',
      'Hyperbola': 'hyperbola|transverse axis|conjugate axis|rectangular hyperbola|asymptote|eccentricity of hyperbola',
    }),
    'Pair of Straight Lines': C('pair of straight lines|pair of lines|combined equation|homogeneous equation|angle bisectors', {
      'Combined Equation': 'pair of straight lines|combined equation|joint equation|second degree homogeneous',
      'Angle Bisectors': 'angle bisectors|bisector of the angle|bisectors of the lines',
      'General Second Degree Equation': 'second degree equation|general equation of second degree|condition for pair of lines',
    }),
    Vectors: C('vector|vectors|dot product|cross product|scalar product|vector product|direction cosines|direction ratios|unit vector|position vector', {
      'Scalars & Vectors': 'scalar quantity|vector quantity|unit vector|zero vector|position vector|equal vectors|collinear vectors|coplanar vectors|like vector|unlike vector',
      'Product of Vectors': 'dot product|scalar product|cross product|vector product|box product|scalar triple product|vector triple product|rectangular components',
      'Direction Cosines & Ratios': 'direction cosines|direction ratios',
      'Applications of Vectors': 'work done by a force vector|moment of a force|resultant of vectors|section formula in vector|linearly independent vectors',
    }),
    'Three Dimensional Geometry': C('line in space|plane in space|angle between planes|skew lines|distance of a point from a plane|3d geometry|coplanar lines|equation of plane', {
      'Equation of a Plane': 'equation of plane|plane passing through|intercept form of plane|normal form of plane',
      'Line in Space': 'equation of line in space|symmetric form of line|vector equation of line|line passing through a point',
      'Angle & Distance': 'angle between two planes|angle between line and plane|distance of a point from a plane|distance between parallel planes|skew lines|shortest distance',
    }),
    'Complex Numbers': C('complex number|complex numbers|imaginary|argand plane|modulus of complex|conjugate of complex|cube root of unity|iota', {
      'Algebra of Complex Numbers': 'complex number|algebra of complex|equality of complex numbers|conjugate of complex|real part|imaginary part',
      'Modulus & Amplitude': 'modulus of complex|amplitude of complex|argument of complex|argand diagram|polar form of complex|euler form|exponential form of complex',
      'Roots of Unity': 'cube root of unity|nth roots of unity|square root of complex|de moivre theorem|rotation theorem',
    }),
    'Sequences & Series': C('arithmetic progression|geometric progression|harmonic progression|a p|g p|h p|nth term|sum of n terms|arithmetic mean|geometric mean|harmonic mean|series', {
      'Arithmetic Progression': 'arithmetic progression|a p|common difference|nth term of a p|sum of first n terms|arithmetic mean',
      'Geometric Progression': 'geometric progression|g p|common ratio|nth term of g p|sum of infinite|geometric mean|sum to infinity',
      'Harmonic Progression': 'harmonic progression|h p|harmonic mean',
      'Special Series': 'sum of squares|sum of cubes|sum of first n natural|power series|sigma notation|sigma',
    }),
    'Permutations & Combinations': C('permutation|permutations|combination|combinations|arrangement|selection|factorial|can be formed|without repetition|with repetition', {
      'Fundamental Principle of Counting': 'fundamental principle of counting|multiplication principle|addition principle',
      'Permutations': 'permutation|permutations|arrangement of letters|words can be formed|arranged in a row|distinct objects|repetition allowed',
      'Combinations': 'combination|combinations|selection of players|committee can be chosen|handshakes|selection of questions',
    }),
    'Sets, Relations & Functions': C('set|sets|subset|union|intersection|venn diagram|relation|equivalence relation|one one function|onto function|domain|range', {
      'Sets & Operations': 'subset|proper subset|power set|union of sets|intersection of sets|venn diagram|universal set|complement of set|disjoint sets|cartesian product',
      'Types of Relations': 'reflexive|symmetric|transitive|equivalence relation|identity relation|inverse relation|number of relations',
      'Functions': 'one one function|onto function|into function|bijective|many one|composite function|inverse function|domain and range|types of functions|real valued function|equal function',
    }),
    'Limits & Continuity': C('limit|limits|continuity|continuous function|left hand limit|right hand limit|indeterminate form|discontinuity', {
      'Limits': 'limit of function|left hand limit|right hand limit|indeterminate form|algebra of limits|limits at infinity|substitution method|factorisation method|rationalisation method|standard limits',
      'Continuity': 'continuity of a function|continuous function|discontinuous|removable discontinuity|discontinuity at a point|continuity in interval',
    }),
    Differentiation: C('derivative|derivative of|differentiate|differentiation|dy/dx|chain rule|implicit differentiation|parametric differentiation', {
      'Derivatives of Composite Functions': 'chain rule|derivative of composite|composite function derivative',
      'Implicit & Parametric Differentiation': 'implicit function|implicit differentiation|parametric form|parametric equations|dy dx by dt',
      'Logarithmic Differentiation': 'logarithmic differentiation|derivative of x power x|differentiating logarithm',
      'Second Order Derivative': 'second order derivative|second derivative|d2y dx2',
      'Derivatives of Special Functions': 'derivative of inverse trigonometric|derivative of determinant|differentiation of inverse',
    }),
    'Applications of Derivatives': C('rate of change|maxima|minima|maximum value|minimum value|increasing function|decreasing function|tangent to curve|normal to curve|approximation by derivative', {
      'Rate of Change': 'rate of change|rate at which|increasing at the rate|volume increasing|area increasing',
      'Maxima & Minima': 'maxima|minima|maximum value|minimum value|local maximum|local minimum|absolute maximum|point of inflection|second derivative test',
      'Monotonicity': 'increasing function|decreasing function|strictly increasing|strictly decreasing|interval in which function',
      'Tangent, Normal & Approximation': 'tangent to the curve|normal to the curve|slope of tangent|approximation|small change in',
    }),
    Integration: C('integral|integration|integrate|indefinite integral|antiderivative|by parts|integration by substitution|partial fractions dx', {
      'Standard Integrals': 'indefinite integral|standard integrals|antiderivative|the integral of|integral of x|general integral',
      'Methods of Integration': 'integration by substitution|integration by parts|partial fraction integration|integration by decomposition',
      'Integrals of Special Functions': 'integral of 1 by a2 plus x2|integral of sqrt|integral of tan|integral of sec|integral of log',
    }),
    'Definite Integration & Applications': C('definite integral|limits of integration|area under the curve|area bounded|upper limit|lower limit', {
      'Properties of Definite Integrals': 'definite integral|properties of definite|limits of integration|upper limit|lower limit|even function integral|odd function integral',
      'Area Under Curves': 'area under the curve|area bounded by|area between curve and line|area enclosed by|area of the region',
    }),
    'Differential Equations': C('differential equation|order and degree|homogeneous differential|variable separable|integrating factor|linear differential equation', {
      'Order & Degree': 'order and degree of differential|order of differential|degree of differential',
      'Variable Separable': 'variable separable|separable equation|separating the variables',
      'Homogeneous Equations': 'homogeneous differential|homogeneous equation in dy dx',
      'Linear Differential Equations': 'linear differential equation|integrating factor|first order first degree',
    }),
    Probability: C('probability|random experiment|sample space|mutually exclusive|independent events|bayes theorem|conditional probability|odds in favour', {
      'Classical Probability': 'probability of getting|random experiment|sample space|equally likely|favourable outcomes|mutually exclusive|exhaustive events',
      'Conditional Probability & Bayes': 'conditional probability|bayes theorem|given that|independent events|dependent events|multiplication theorem',
      'Permutations in Probability': 'probability that|balls are drawn|cards are drawn|dice are thrown|coin is tossed|without replacement|with replacement',
    }),
    'Probability Distributions': C('random variable|probability distribution|expected value|variance of|binomial distribution|poisson distribution|normal distribution|bernoulli trial', {
      'Random Variable & Expectation': 'random variable|probability distribution|expected value|variance of random|p m f|probability mass function',
      'Binomial Distribution': 'binomial distribution|bernoulli trial|mean and variance of binomial|mean of binomial distribution|n p q',
      'Poisson & Normal Distribution': 'poisson distribution|normal distribution|standard normal|z score|area under normal curve',
    }),
    Statistics: C('variance|standard deviation|mean deviation|coefficient of variation|correlation|regression|karl pearson|scatter diagram|covariance', {
      'Measures of Dispersion': 'variance|standard deviation|mean deviation|coefficient of variation|range of data|quartile deviation',
      'Analysis of Frequency Distribution': 'coefficient of variation|comparison of two series|frequency distribution table|more variable|less consistent',
      'Correlation & Regression': 'correlation|regression|karl pearson|scatter diagram|covariance|regression line|regression coefficient|spearmans rank',
    }),
    'Linear Programming': C('linear programming|l p p|objective function|feasible region|corner point method|optimal solution|graphical method of solving', {
      'Formulation of LPP': 'objective function|constraints|linear programming problem|formulate the lpp|mathematical formulation',
      'Graphical Solution': 'feasible region|corner point method|optimal solution|graphical method|maximum profit|minimum cost|bounded feasible',
    }),
    'Quadratic Equations': C('quadratic equation|roots of equation|discriminant|nature of roots|sum of roots|product of roots', {
      'Roots & Coefficients': 'quadratic equation|sum of roots|product of roots|roots of the equation|value of k for equal roots',
      'Nature of Roots': 'discriminant|nature of roots|real and equal roots|imaginary roots|real and distinct',
    }),
    Logarithms: C('logarithm|logarithms|antilogarithm|characteristic and mantissa|log of number|laws of logarithm', {
      'Laws of Logarithms': 'laws of logarithm|log a plus log b|change of base',
      'Logarithmic Equations': 'logarithmic equation|solve for x log|antilogarithm|characteristic and mantissa',
    }),
    'Binomial Theorem': C('binomial theorem|binomial expansion|general term|middle term|binomial coefficient|term in the expansion', {
      'Expansion & General Term': 'binomial theorem|binomial expansion|general term|term independent of x|coefficient of x in expansion',
      'Middle Term & Applications': 'middle term|greatest coefficient|number of terms in expansion',
    }),
    'Measures of Central Tendency': C('mean of data|median of data|mode of data|combined mean|arithmetic mean of grouped|weighted mean', {
      'Mean, Median & Mode': 'mean of the following|median of the following|mode of the following|grouped data|weighted mean|combined mean',
    }),
  }),

  Physics: C('physics|physical quantity', {
    'Units & Measurements': C('si unit|dimensional formula|significant figures|error in measurement|fundamental unit|derived unit|vernier|screw gauge|dimension of physical|unit of force|unit of work|unit of power|unit of energy', {
      'Systems of Units': 'si unit|c g s unit|fundamental unit|derived unit|unit of force|unit of work|unit of power|unit of energy|unit of pressure',
      'Dimensional Analysis': 'dimensional formula|dimension of physical|dimensionally correct|dimensionless quantity',
      'Errors & Instruments': 'significant figures|error in measurement|percentage error|vernier calliper|screw gauge|least count|zero error',
    }),
    'Motion in a Plane': C('velocity|acceleration|displacement|projectile|relative velocity|uniform motion|speed|average velocity|retardation|kinematic equation', {
      'Motion in a Straight Line': 'uniform velocity|average velocity|instantaneous velocity|retardation|kinematic equation|uniformly accelerated|accelerates uniformly|uniform acceleration|from rest|distance travelled in',
      'Projectile Motion': 'projectile|angle of projection|range of projectile|time of flight|maximum height of projectile|horizontal range|projected with velocity',
      'Relative Velocity': 'relative velocity|river boat|swimmer crosses|man walks|rain drops appear|moves with respect to',
      'Uniform Circular Motion': 'circular motion|centripetal acceleration|angular displacement|angular velocity|linear speed|radial acceleration',
    }),
    'Laws of Motion': C('newton s law|force acting|friction|tension in|string|impulse|momentum|inertia|centripetal force|banking of road|free body', {
      'Newton s Laws': 'newton s first law|newton s second law|newton s third law|newton s law|net force|resultant force|force acting on|acceleration of the body|inertia',
      'Friction': 'friction|coefficient of friction|limiting friction|kinetic friction|static friction|angle of repose|angle of friction|rough surface|smooth surface',
      'Circular Motion Applications': 'centripetal force|banking of road|angle of banking|conical pendulum|vertical circle|maximum speed|circular track',
      'Impulse & Momentum': 'impulse|linear momentum|change in momentum|force for a short time|collision time',
    }),
    'Work, Energy & Power': C('work done|kinetic energy|potential energy|power of|conservation of energy|work energy theorem|coefficient of restitution|collision', {
      'Work & Power': 'work done|work done by the force|power of the engine|power output|rate of doing work|kilowatt|horse power',
      'Energy Conservation': 'kinetic energy|potential energy|conservation of energy|mechanical energy|work energy theorem|energy stored',
      'Collisions': 'collision|elastic collision|inelastic collision|coefficient of restitution|head on collision|perfectly inelastic|bodies collide',
    }),
    Gravitation: C('gravitation|gravitational|kepler|escape velocity|orbital velocity|satellite|acceleration due to gravity|geostationary|weight on the planet', {
      'Kepler s Laws': 'kepler|law of areas|law of periods|areal velocity|orbit of planet',
      'Newton s Law of Gravitation': 'gravitational force|law of gravitation|gravitational constant|force between two masses|variation of g|depth and height|acceleration due to gravity',
      'Gravitational Potential & Energy': 'gravitational potential|potential energy of satellite|binding energy|escape velocity|orbital velocity|period of revolution',
      'Satellites': 'satellite|geostationary|orbital velocity of satellite|time period of satellite|total energy of satellite|artificial satellite',
    }),
    'Rotational Dynamics': C('rotational|moment of inertia|torque|angular momentum|angular velocity|centre of mass|radius of gyration|rolling motion|parallel axis theorem|perpendicular axis theorem', {
      'Moment of Inertia': 'moment of inertia|radius of gyration|parallel axis theorem|perpendicular axis theorem|axis of rotation|rotational inertia',
      'Torque & Angular Momentum': 'torque|angular momentum|couple|angular acceleration|conservation of angular momentum|rotational kinetic energy',
      'Rolling Motion': 'rolling motion|rolling without slipping|body rolls|acceleration of rolling|velocity at the bottom|inclined plane rolling',
      'Centre of Mass': 'centre of mass|center of mass|shift in centre|two particle system',
    }),
    'Mechanical Properties of Solids': C('stress|strain|young s modulus|bulk modulus|rigidity modulus|poisson s ratio|elastic limit|elasticity|energy stored in wire', {
      'Elastic Constants': 'stress|strain|young s modulus|bulk modulus|rigidity modulus|modulus of elasticity|poisson s ratio|elastic limit|yield point|breaking stress',
      'Elastic Potential Energy': 'energy stored in wire|energy per unit volume|work done in stretching|elongation of wire|extension of wire',
    }),
    'Mechanical Properties of Fluids': C('fluid|viscosity|terminal velocity|surface tension|capillary|bernoulli|streamline flow|reynolds number|stokes law|buoyancy|archimedes|pressure in liquid', {
      'Fluid Pressure & Pascal s Law': 'pressure at a point|pascal s law|hydraulic|pressure exerted by liquid|gauge pressure|absolute pressure',
      'Viscosity & Stokes Law': 'viscosity|viscous force|terminal velocity|stokes law|coefficient of viscosity|poiseuille|flow through capillary',
      'Surface Tension': 'surface tension|surface energy|capillary rise|angle of contact|excess pressure inside drop|soap bubble|work done in blowing',
      'Bernoulli s Principle': 'bernoulli|streamline flow|turbulent flow|reynolds number|velocity of efflux|venturimeter|torricelli',
      'Buoyancy & Floatation': 'buoyancy|archimedes principle|buoyant force|floats in water|apparent weight|specific gravity|density of liquid',
    }),
    'Kinetic Theory of Gases and Radiation': C('kinetic theory|ideal gas|degree of freedom|mean free path|gas constant|r m s speed|root mean square speed|maxwell distribution|molar gas constant|equipartition|thermal expansion|specific heat|latent heat|calorimeter|conduction of heat|convection|radiation of heat|anomalous expansion|coefficient of expansion', {
      'Assumptions & Pressure': 'kinetic theory of gases|pressure exerted by gas|ideal gas equation|assumptions of kinetic|molecular motion',
      'Speeds of Gas Molecules': 'r m s speed|root mean square|average speed of molecules|most probable speed|mean free path',
      'Law of Equipartition & Degrees': 'degree of freedom|equipartition of energy|law of equipartition|specific heat of gas|molar specific heat|atomicity of gas',
      'Thermal Expansion': 'thermal expansion|coefficient of linear expansion|coefficient of volumetric expansion|apparent expansion|anomalous expansion of water|expands on heating',
      'Calorimetry': 'specific heat|latent heat|calorimeter|heat gained|heat lost|principle of calorimetry|melting point|boiling point',
      'Heat Transfer & Radiation': 'conduction|convection|radiation|thermal conductivity|thermal resistance|newton s law of cooling|black body|emissive power|stefan s law|wein s law|kirchhoff s law of radiation|radiation of heat',
    }),
    Thermodynamics: C('thermodynamic|first law of thermodynamics|isothermal|adiabatic|isobaric|isochoric|entropy|carnot engine|heat engine|refrigerator|efficiency of engine', {
      'First Law & Processes': 'first law of thermodynamics|isothermal process|adiabatic process|isobaric|isochoric|cyclic process|internal energy|work done in expansion',
      'Heat Engines & Entropy': 'carnot engine|heat engine|efficiency of engine|refrigerator|coefficient of performance|entropy change|second law of thermodynamics|sink and source',
    }),
    Oscillations: C('oscillation|simple harmonic|s h m|pendulum|amplitude of oscillation|time period of oscillation|damped oscillation|resonance|phase difference', {
      'Simple Harmonic Motion': 'simple harmonic|s h m|shm|displacement of particle|amplitude of oscillation|time period of oscillation|frequency of oscillation|angular frequency|phase of oscillation|epoch',
      'Energy in SHM': 'energy of s h m|total energy in shm|kinetic energy in shm|potential energy in shm|mean position|extreme position',
      'Pendulums & Springs': 'pendulum|simple pendulum|seconds pendulum|spring constant|oscillations of spring|combination of springs|effective spring constant',
      'Damped & Forced Oscillations': 'damped oscillation|damping constant|forced oscillation|resonance|natural frequency|quality factor',
    }),
    'Superposition of Waves': C('wave|wavelength|frequency of wave|sound wave|doppler effect|beats|harmonics|organ pipe|vibrating string|progressive wave|stationary wave|superposition of waves', {
      'Progressive Waves': 'progressive wave|travelling wave|wave equation|amplitude of wave|wavefront|phase velocity|transverse wave|longitudinal wave',
      'Superposition & Stationary Waves': 'stationary wave|standing wave|superposition of waves|nodes and antinodes|harmonics|overtones|fundamental frequency',
      'Vibrating Strings & Pipes': 'vibrating string|sonometer|organ pipe|open pipe|closed pipe|end correction|laws of vibration of string',
      'Beats & Doppler Effect': 'beats|beat frequency|doppler effect|apparent frequency|source moves|observer moves|pitch of sound|speed of sound',
    }),
    'Ray Optics': C('ray optics|mirror|lens|refraction|refractive index|total internal reflection|prism|microscope|telescope|focal length|power of lens|dispersion of light', {
      'Reflection & Mirrors': 'mirror|concave mirror|convex mirror|spherical mirror|mirror formula|magnification by mirror|image formed by mirror',
      'Refraction & Lenses': 'refraction|refractive index|total internal reflection|critical angle|lens|convex lens|concave lens|lens formula|focal length|power of lens|combination of lenses|magnification by lens|image formed by lens',
      'Prism & Dispersion': 'prism|angle of prism|minimum deviation|dispersion of light|angular dispersion|dispersive power|spectrum|rainbow',
      'Optical Instruments': 'microscope|compound microscope|telescope|astronomical telescope|magnifying power|resolving power of telescope|simple microscope',
    }),
    'Wave Optics': C('wave optics|interference|diffraction|young s experiment|double slit|fringe width|coherent sources|polarisation|polarization|huygens principle|resolving power', {
      'Interference': 'interference|constructive interference|destructive interference|young s experiment|double slit|fringe width|coherent sources|path difference|bright fringe|dark fringe|thin film',
      'Diffraction': 'diffraction|single slit diffraction|diffraction pattern|width of central maximum|limit of resolution|resolving power',
      'Polarisation': 'polarisation|polarization|polaroid|brewster s law|angle of polarisation|plane polarised|malus law|dichroism',
    }),
    Electrostatics: C('electrostatic|electric charge|coulomb s law|electric field|gauss law|electric potential|capacitance|capacitor|dielectric|electric dipole|charge on', {
      'Electric Charges & Coulomb s Law': 'electric charge|coulomb s law|force between charges|quantisation of charge|conservation of charge|two charges|charge q|point charge',
      'Electric Field & Gauss Law': 'electric field|gauss law|electric flux|field due to|infinite sheet|charged sphere|field intensity',
      'Potential & Dipole': 'electric potential|potential difference|potential energy of charge|electric dipole|dipole moment|torque on dipole|equipotential',
      'Capacitors': 'capacitance|capacitor|parallel plate capacitor|dielectric constant|combination of capacitors|energy stored in capacitor|energy density|van de graaff',
    }),
    'Current Electricity': C('current electricity|resistance|ohm s law|emf|internal resistance|potentiometer|wheatstone bridge|kirchhoff s law|ammeter|voltmeter|resistivity|drift velocity|galvanometer', {
      'Ohm s Law & Resistance': 'ohm s law|resistance|resistivity|current density|drift velocity|relaxation time|colour code|series and parallel resistance|equivalent resistance|specific resistance',
      'Cells & EMF': 'emf|internal resistance|terminal voltage|cells in series|cells in parallel|charging and discharging',
      'Instruments': 'wheatstone bridge|metre bridge|potentiometer|kirchhoff s law|kirchhoff s rule|ammeter|voltmeter|shunt|galvanometer|conversion of galvanometer',
    }),
    'Magnetic Fields due to Electric Current': C('magnetic field due to|biot savart|ampere s circuital law|solenoid|toroid|cyclotron|lorentz force|moving coil galvanometer|force on current carrying|force between current', {
      'Magnetic Field due to Current': 'magnetic field due to|biot savart|ampere s circuital law|solenoid|toroid|circular loop|infinite wire|straight conductor',
      'Force on Charges & Conductors': 'lorentz force|magnetic force|force on current carrying|force between current|force on charged particle|cyclotron|helical path',
      'Instruments & Devices': 'moving coil galvanometer|conversion of galvanometer|current sensitivity|voltmeter from galvanometer|ammeter from galvanometer',
    }),
    Magnetism: C('magnetic dipole|bar magnet|magnetic moment|earth s magnetism|magnetic elements', {
      'Bar Magnet & Dipole': 'bar magnet|magnetic dipole|magnetic moment|torque on magnet|magnetic field of bar magnet|tangent law|vibration magnetometer',
      'Earth s Magnetism': 'earth s magnetism|magnetic elements|angle of dip|angle of declination|horizontal component of earth|magnetic meridian',
    }),
    'Magnetic Materials': C('magnetic material|diamagnetic|paramagnetic|ferromagnetic|magnetic susceptibility|permeability|hysteresis|curie temperature|magnetic domains|soft iron|hard steel', {
      'Magnetic Materials': 'diamagnetic|paramagnetic|ferromagnetic|magnetic susceptibility|permeability|hysteresis loop|curie temperature|curie point|magnetic domains|soft iron|hard steel',
    }),
    'Electromagnetic Induction': C('electromagnetic induction|faraday s law|lenz s law|self inductance|mutual inductance|induced emf|eddy current|motional emf|flux linked|coil', {
      'Faraday s & Lenz s Laws': 'electromagnetic induction|faraday s law|faradays law|lenz s law|lenzs law|induced emf|induced current|magnetic flux|flux change|flux linked',
      'Self & Mutual Inductance': 'self inductance|mutual inductance|coefficient of coupling|inductance of solenoid|energy stored in inductor|back emf',
      'Motional EMF & Eddy Currents': 'motional emf|rod moving in magnetic|eddy current|eddy currents|application of eddy',
    }),
    'AC Circuits': C('alternating current|rms value|reactance|impedance|resonance in circuit|power factor|choke coil|transformer|l c oscillation|phasor diagram|power dissipated', {
      'AC Fundamentals': 'alternating current|a c source|rms value|peak value|average power|instantaneous power|phase difference between voltage',
      'LCR Circuits & Resonance': 'reactance|impedance|resonance in circuit|series l c r|power factor|quality factor|bandwidth|choke coil|wattless current',
      'Transformers': 'transformer|turns ratio|step up transformer|step down transformer|efficiency of transformer|losses in transformer|transmission of power',
    }),
    'Electromagnetic Waves': C('electromagnetic wave|electromagnetic spectrum|displacement current|gamma rays|radio waves|microwaves|electromagnetic radiation|intensity of electromagnetic', {
      'EM Wave Properties': 'electromagnetic wave|displacement current|maxwell equation|speed of electromagnetic|electromagnetic radiation|intensity of electromagnetic|radiation pressure',
      'EM Spectrum': 'electromagnetic spectrum|gamma rays|radio waves|microwaves|ultraviolet|infrared waves|x rays region|communication band',
    }),
    'Dual Nature of Radiation and Matter': C('photoelectric|photon|work function|einstein s photoelectric|de broglie|matter wave|threshold frequency|stopping potential|photoemission', {
      'Photoelectric Effect': 'photoelectric effect|photoelectric emission|work function|threshold frequency|stopping potential|einstein s equation|photoelectric current|photocell',
      'De Broglie Waves': 'de broglie|debroglie|matter wave|wavelength of electron|davisson germer|wave nature of particle',
    }),
    'Structure of Atoms and Nuclei': C('bohr s model|hydrogen spectrum|energy level|rydberg|rutherford model|atomic model|balmer series|orbital radius|impact parameter|nucleus|nucleon|isotope|mass defect|binding energy|radioactivity|half life|decay constant|nuclear fission|nuclear fusion|alpha decay|beta decay|gamma emission|radioactive decay', {
      'Bohr s Model': 'bohr s model|bohr radius|energy of electron in|energy level|orbit of electron|angular momentum of electron|ionisation energy of hydrogen',
      'Atomic Spectra': 'hydrogen spectrum|rydberg constant|balmer series|lyman series|spectral series|wavelength of emitted|transition of electron',
      'Rutherford Experiment': 'rutherford|rutherford model|alpha particle scattering|impact parameter|distance of closest approach',
      'Nuclear Composition': 'nucleus|nucleon|isotope|isobar|isotone|mass defect|binding energy|binding energy per nucleon|nuclear density|nuclear force',
      'Radioactivity': 'radioactivity|radioactive decay|half life|mean life|decay constant|activity of sample|alpha decay|beta decay|gamma emission|disintegration constant|radioactive element',
      'Fission & Fusion': 'nuclear fission|nuclear fusion|chain reaction|energy released in fission|mass energy relation|nuclear reactor|critical mass',
    }),
    'Semiconductor Devices': C('semiconductor|p n junction|diode|rectifier|transistor|logic gate|zener|led|solar cell|intrinsic semiconductor|extrinsic|doping|n type|p type', {
      'Semiconductor Basics': 'semiconductor|intrinsic semiconductor|extrinsic semiconductor|doping|n type|p type|majority carrier|minority carrier|energy band|band gap|fermi level',
      'Junction Devices': 'p n junction|forward bias|reverse bias|diode|zener diode|rectifier|half wave rectifier|full wave rectifier|led|photodiode|solar cell|photocurrent',
      'Transistors & Amplifiers': 'transistor|n p n transistor|p n p transistor|transistor amplifier|current gain|voltage gain|oscillator|transistor characteristics',
      'Digital Electronics': 'logic gate|logic gates|nand gate|nor gate|not gate|and gate|or gate|universal gate|truth table of gate|boolean expression',
    }),
    'Communication Systems': C('communication system|modulation|antenna|carrier wave|amplitude modulation|frequency modulation|bandwidth of signal|line communication|ground wave|space wave', {
      'Modulation & Transmission': 'modulation|amplitude modulation|frequency modulation|carrier wave|antenna|modulating signal|bandwidth of signal|repeater station|broadcasting',
      'Propagation of Waves': 'ground wave|space wave|sky wave|ionospheric propagation|line of sight communication|satellite communication|maximum usable frequency',
    }),
  }),

  Chemistry: C('chemistry|chemical', {
    'Some Basic Concepts of Chemistry': C('mole|molar mass|stoichiometry|empirical formula|molecular formula|limiting reagent|percentage composition|avogadro s number|molarity|molality|law of definite proportions', {
      'Mole Concept': 'mole|number of moles|molar mass|gram molecular|avogadro s number|avogadro number|particles in one mole',
      'Stoichiometry': 'stoichiometry|limiting reagent|limiting reactant|percentage composition|law of conservation of mass|law of definite proportions|law of multiple proportions|law of reciprocal',
      'Concentration Terms': 'molarity|molality|mole fraction|normality|mass percentage|ppm|concentration of solution',
    }),
    'Structure of Atom': C('atomic structure|orbital|quantum number|subshell|aufbau principle|hund s rule|pauli exclusion|electronic configuration|bohr s model|hydrogen spectrum|heisenberg|schrodinger wave equation|de broglie relation', {
      'Subatomic Particles & Models': 'atomic structure|bohr s model|rutherford model|thomson model|subatomic particle|discovery of electron|proton and neutron|cathode ray|anode ray',
      'Quantum Mechanical Model': 'orbital|quantum number|quantum numbers|subshell|aufbau principle|hund s rule|pauli exclusion|electronic configuration|schrodinger wave equation|heisenberg uncertainty|de broglie relation|probability density|shape of orbital|azimuthal quantum|magnetic quantum|principal quantum number',
      'Atomic Spectra': 'hydrogen spectrum|spectral lines|rydberg formula|emission spectrum|absorption spectrum|transition between energy levels',
    }),
    'Chemical Bonding': C('chemical bond|ionic bond|covalent bond|hybridisation|hybridization|vsepr|molecular orbital|valence bond|sigma bond|pi bond|bond order|dipole moment|resonance structure|lattice energy|hydrogen bonding|van der waals', {
      'VSEPR & Shapes': 'vsepr|shape of molecule|geometry of molecule|lone pair|bond pair|linear shape|tetrahedral shape|trigonal|bent shape|pyramidal shape|hybridisation|hybridization|sp3|sp2|hybrid orbital',
      'Valence Bond & MO Theory': 'valence bond|molecular orbital|molecular orbital theory|bond order|m o diagram|bonding orbital|antibonding orbital|sigma bond|pi bond|orbital overlap',
      'Bond Parameters': 'bond length|bond angle|bond enthalpy|dipole moment|polarity of molecule|resonance structure|formal charge|lattice energy|covalent character|ionic character',
      'Intermolecular Forces': 'hydrogen bonding|hydrogen bond|van der waals forces|london forces|dipole dipole attraction|boiling point comparison|physical state due to',
    }),
    'Redox Reactions': C('redox|oxidation number|oxidation state|oxidising agent|reducing agent|disproportionation|balancing redox|electron transfer reaction', {
      'Oxidation Numbers': 'oxidation number|oxidation state|oxidation number of|change in oxidation',
      'Redox Titrations & Agents': 'redox titration|oxidising agent|reducing agent|disproportionation reaction|half reaction|electron transfer|balancing redox',
    }),
    'Gaseous State': C('gas laws|ideal gas equation|compressibility factor|van der waals equation|critical temperature|liquefaction of gas|real gas|pressure of gas| Boyle s law|charles law|gay lussac', {
      'Ideal Gas Behaviour': 'ideal gas|ideal gas equation|gas laws|boyle s law|charles law|gay lussac law|avogadro law|partial pressure|dalton s law|gram moles of gas',
      'Real Gases': 'real gas|compressibility factor|van der waals equation|van der waals constant|critical temperature|critical pressure|liquefaction of gas|inversion temperature|z value',
    }),
    'Solutions & Colligative Properties': C('solution|colligative|raoult s law|osmotic pressure|osmosis|elevation of boiling point|depression of freezing point|vapour pressure of solution|henry s law|ideal solution|azeotrope|mass percent', {
      'Raoult s Law & Vapour Pressure': 'raoult s law|vapour pressure of solution|vapour pressure of liquid|relative lowering|mole fraction in solution|volatile solute',
      'Colligative Properties': 'colligative|osmotic pressure|osmosis|elevation of boiling point|depression of freezing point|freezing point of solution|boiling point of solution|semipermeable membrane|isotonic solution|hypertonic|hypotonic',
      'Solutions & Solubility': 'solubility of gas|henry s law|ideal solution|non ideal solution|azeotrope|mass percent|dissolution|solute and solvent',
    }),
    'Thermodynamics & Thermochemistry': C('enthalpy|entropy|gibbs energy|spontaneity|hess s law|bond enthalpy|internal energy|heat of reaction|exothermic|endothermic|standard enthalpy|calorific value', {
      'First Law & Enthalpy': 'enthalpy|internal energy|first law of thermodynamics|heat of reaction|enthalpy change|exothermic reaction|endothermic reaction|standard enthalpy|enthalpy of formation|enthalpy of combustion|enthalpy of neutralisation',
      'Hess s Law & Bond Energy': 'hess s law|bond enthalpy|bond energy|calorific value|energy of combustion',
      'Entropy & Spontaneity': 'entropy|entropy change|gibbs energy|gibbs free energy|spontaneity|spontaneous process|feasibility of reaction|second law of thermodynamics|criterion for spontaneity',
    }),
    'Chemical Equilibrium': C('equilibrium constant|le chatelier|reversible reaction|degree of dissociation|homogeneous equilibrium|heterogeneous equilibrium|kc and kp|equilibrium mixture', {
      'Law of Mass Action': 'equilibrium constant|law of mass action|kc and kp|relation between kc and kp|equilibrium concentration|equilibrium mixture|units of equilibrium constant',
      'Le Chatelier s Principle': 'le chatelier|le chatelier s principle|effect of temperature on equilibrium|effect of pressure on equilibrium|shift in equilibrium|synthesis of ammonia',
      'Applications & Factors': 'degree of dissociation|homogeneous equilibrium|heterogeneous equilibrium|simultaneous equilibrium|effect of catalyst on equilibrium|active mass',
    }),
    'Ionic Equilibria': C('ionic equilibrium|ph of|buffer solution|common ion effect|hydrolysis of salt|acid base indicator|solubility product|ostwald dilution law|degree of dissociation of weak|ka and kb', {
      'Acids, Bases & pH': 'ph of|ph value|ionic product of water|strong acid|weak acid|strong base|weak base|degree of dissociation of weak|ostwald dilution law|ka and kb|ka value|pk a',
      'Buffers & Solubility': 'buffer solution|common ion effect|hydrolysis of salt|salt hydrolysis|acid base indicator|solubility product|ksp|precipitation of|selective precipitation',
    }),
    'Solid State': C('unit cell|crystal lattice|bravais lattice|packing efficiency|voids in crystal|fcc|bcc|space lattice|schottky defect|frenkel defect|coordination number of crystal|point defect', {
      'Crystal Lattices & Unit Cells': 'unit cell|crystal lattice|bravais lattice|space lattice|primitive unit cell|centred unit cell|crystal systems|lattice parameters',
      'Close Packing & Voids': 'packing efficiency|packing fraction|voids in crystal|octahedral void|tetrahedral void|close packed structure|fcc|bcc|hcp|number of atoms per unit cell',
      'Crystal Defects': 'schottky defect|frenkel defect|point defect|impurity defect|stoichiometric defect|non stoichiometric defect',
    }),
    Electrochemistry: C('electrochemistry|electrolysis|faraday s law of electrolysis|nernst equation|electrode potential|galvanic cell|electrolytic cell|standard reduction potential|molar conductivity|kohlrausch law|conductance of solution', {
      'Electrolysis & Faraday s Laws': 'electrolysis|faraday s law of electrolysis|faradays law of electrolysis|electrolytic cell|amount of deposit|quantity of charge|electrochemical equivalent',
      'Galvanic Cells & Potentials': 'galvanic cell|voltaic cell|electrode potential|standard reduction potential|standard cell potential|nernst equation|emf of cell|cell reaction|reference electrode|hydrogen electrode|salt bridge',
      'Conductance': 'molar conductivity|equivalent conductivity|kohlrausch law|kohlrausch s law|conductance|specific conductance|cell constant|decrease in molar conductivity',
    }),
    'Chemical Kinetics': C('rate of reaction|rate constant|order of reaction|rate law|activation energy|arrhenius equation|first order reaction|pseudo first order|half life of reaction|molecularity|rate determining step', {
      'Rate Laws & Orders': 'rate of reaction|rate constant|order of reaction|rate law|rate expression|first order reaction|zero order reaction|second order reaction|pseudo first order|initial rate|instantaneous rate',
      'Integrated Rate Equations': 'half life of reaction|half life period|time for completion|integrated rate|concentration after|decay of reactant',
      'Temperature Dependence & Catalyst': 'activation energy|arrhenius equation|arrhenius plot|temperature coefficient|effect of catalyst|rate determining step|molecularity|collision theory|catalyst increases rate',
    }),
    'Elements of p-Block': C('p block|p block element|group 13|group 14|group 15|group 16|group 17|group 18|noble gas|halogen|interhalogen|diborane|borax|ozone|sulphuric acid manufacture|chlorine gas|bleaching powder|xenon fluoride|inert gas', {
      'Group 13 & 14 (Boron, Carbon)': 'diborane|borax|boron|aluminium|aluminum|allotropes of carbon|silicon|silicate|silica|carbon monoxide|tin and lead',
      'Group 15, 16 & 17': 'nitrogen|phosphorus|ammonia|nitric acid|ozone|sulphur dioxide|sulphuric acid|sulphuric acid manufacture|halogen|chlorine|bleaching powder|fluorine|bromine|interhalogen',
      'Group 18 (Noble Gases)': 'noble gas|inert gas|xenon|xenon fluoride|helium|neon|argon|radon|clathrate',
    }),
    'd & f Block Elements': C('d block|transition element|lanthanoid|actinoid|lanthanide contraction|f block|inner transition|magnetic moment of complex|oxidation state of transition|interstitial compound', {
      'Transition Metals': 'd block|transition element|transition metal|oxidation state of transition|variable oxidation state|coloured ion|magnetic moment of|paramagnetic ion|interstitial compound|alloy steel|potassium dichromate|potassium permanganate',
      'Lanthanoids & Actinoids': 'lanthanoid|actinoid|lanthanide contraction|f block|inner transition element|mischmetal|uranium|thorium',
    }),
    'Coordination Compounds': C('coordination compound|complex ion|ligand|coordination number|crystal field theory|cft|isomerism in coordination|werner s theory|stability constant|hybridisation of complex|spectrochemical series', {
      'Nomenclature & Isomerism': 'coordination compound|nomenclature of coordination|iupac name of complex|complex ion|isomerism in coordination|ionisation isomerism|linkage isomerism|geometrical isomerism of complex|werner s theory',
      'Bonding Theories': 'ligand|coordination number|crystal field theory|cft|valence bond theory of complex|hybridisation of complex|d orbital splitting|spectrochemical series|strong field ligand|weak field ligand|high spin|low spin',
      'Stability & Applications': 'stability constant|instability constant|application of coordination compound|estimation of hardness|detergent action',
    }),
    's-Block Elements': C('s block|alkali metal|alkaline earth metal|sodium carbonate|sodium hydroxide|caustic soda|washing soda|baking soda|plaster of paris|quick lime|biological importance of sodium|biological importance of calcium', {
      'Group 1 (Alkali Metals)': 'alkali metal|sodium carbonate|sodium hydroxide|caustic soda|washing soda|baking soda|sodium bicarbonate|sodium chloride|lithium|potassium|flame colouration|biological importance of sodium',
      'Group 2 (Alkaline Earth)': 'alkaline earth metal|magnesium|calcium|plaster of paris|quick lime|slaked lime|lime stone|cement|biological importance of calcium|solubility of sulphates',
    }),
    'Basic Principles of Organic Chemistry': C('homologous series|functional group|iupac name|iupac nomenclature|structural isomerism|stereo isomerism|inductive effect|resonance effect|hyperconjugation|free radical|carbocation|carbanion|electrophile|nucleophile|tautomerism|fission of covalent bond', {
      'Nomenclature & Isomerism': 'iupac name|iupac nomenclature|homologous series|functional group|structural isomerism|chain isomerism|position isomerism|stereo isomerism|geometrical isomerism in organic|optical isomerism|chiral carbon|enantiomer|racemic mixture',
      'Electronic Effects': 'inductive effect|resonance effect|mesomeric effect|hyperconjugation|electron withdrawing|electron releasing|electromeric effect',
      'Reaction Intermediates': 'free radical|carbocation|carbonium|carbanion|electrophile|nucleophile|homolytic fission|heterolytic fission|tautomerism|reaction intermediate',
      'Purification & Estimation': 'estimation of carbon and hydrogen|estimation of nitrogen|kjeldahl|estimation of sulphur|carius method|chromatography|distillation of organic|crystallisation of organic',
    }),
    Hydrocarbons: C('alkane|alkene|alkyne|aromatic|benzene|markovnikov|ozonolysis|cracking|aromaticity|huckel rule|alkyl halide from|wurtz reaction|kolbe electrolysis|substitution reaction|addition reaction', {
      'Alkanes': 'alkane|paraffin|wurtz reaction|kolbe electrolysis|preparation of methane|homolysis of alkane|conformations of alkane|sawhorse formula|newman projection',
      'Alkenes': 'alkene|markovnikov|anti markovnikov|peroxide effect|ozonolysis of alkene|hydration of alkene|electrophilic addition|dehydration of alcohol|preparation of ethene',
      'Alkynes': 'alkyne|acetylene|terminal alkyne|acidic hydrogen of alkyne|markovnikov addition to alkyne|preparation of acetylene|polymerisation of alkyne',
      'Aromatic Compounds': 'aromatic|benzene|aromaticity|huckel rule|substitution reaction in benzene|electrophilic substitution|nitration of benzene|sulphonation of benzene|friedel crafts|resonance in benzene|coal tar|petroleum refining|cracking',
    }),
    'Haloalkanes & Haloarenes': C('haloalkane|haloarene|alkyl halide|aryl halide|sn1|sn2|grignard reagent|freon|chloroform|carbon tetrachloride|dehydrohalogenation|nucleophilic substitution in alkyl|elimination reaction', {
      'Classification & Nomenclature': 'haloalkane|haloarene|alkyl halide|aryl halide|vinyl halide|allyl halide|geminal dihalide|vicinal dihalide',
      'Reactions & Mechanisms': 'sn1|sn2|nucleophilic substitution in alkyl|nucleophilic substitution reaction|dehydrohalogenation|elimination reaction|grignard reagent|wurtz fittig|fittig reaction',
      'Environmental Effects': 'freon|chlorofluorocarbon|cfc|ozone depletion by|chloroform in environment|carbon tetrachloride|halogenated pesticide',
    }),
    'Alcohols, Phenols & Ethers': C('alcohol|phenol|ether|lucas test|kolbe s reaction|reimer tiemann|williamson synthesis|dehydration of alcohol|cresol|glycol|glycerol|rectified spirit|fermentation of molasses', {
      'Alcohols': 'alcohol|preparation of alcohol|fermentation of molasses|dehydration of alcohol|lucas test|oxidation of alcohol|primary alcohol|secondary alcohol|tertiary alcohol|rectified spirit|power alcohol|glycol|glycerol',
      'Phenols': 'phenol|carbolic|cresol|kolbe s reaction|kolbe schmidt|reimer tiemann|cumene process|acidic nature of phenol|nitration of phenol',
      'Ethers': 'ether|williamson synthesis|williamson reaction|diethyl ether|cleavage of ether|peroxide formation in ether|anisole',
    }),
    'Aldehydes, Ketones & Carboxylic Acids': C('aldehyde|ketone|carboxylic acid|tollens test|fehling solution|aldol condensation|cannizzaro reaction|clemmensen reduction|wolff kishner|hinsberg reagent|acetylation|esterification|formaldehyde|acetone|acetic acid|formic acid', {
      'Aldehydes & Ketones': 'aldehyde|ketone|tollens test|tollens reagent|fehling solution|fehling test|aldol condensation|cannizzaro reaction|clemmensen reduction|wolff kishner|iodoform test|formaldehyde|acetone|preparation of aldehyde|preparation of ketone|nucleophilic addition to carbonyl',
      'Carboxylic Acids & Derivatives': 'carboxylic acid|acetic acid|formic acid|esterification|acidity of carboxylic acid|acetyl chloride|acid amide|anhydride of acid|decarboxylation|hvz reaction|hell volhard|soapy detergent from fatty acid',
    }),
    Amines: C('amine|hinsberg reagent|carbylamine reaction|gabriel phthalimide|hoffmann bromamide degradation|coupling reaction|diazonium salt|aniline|basicity of amine|sulphonation of aniline', {
      'Classification & Preparation': 'amine|primary amine|secondary amine|tertiary amine|gabriel phthalimide|gabriel synthesis|hoffmann bromamide degradation|reduction of nitro|ammonolysis of alkyl halide',
      'Basicity & Reactions': 'basicity of amine|basic strength of amine|hinsberg reagent|hinsberg test|carbylamine reaction|carbylamine test|alkylation of amine|acylation of amine|benzoylation',
      'Diazonium Salts': 'diazonium salt|diazotisation|diazotization|coupling reaction|sandmeyer reaction|aniline to|benzene diazonium',
    }),
    Biomolecules: C('biomolecule|carbohydrate|glucose|sucrose|maltose|lactose|starch|cellulose|amino acid|peptide bond|protein|enzyme|vitamin|nucleic acid|dna structure|rna|nucleotide|hormone', {
      'Carbohydrates': 'carbohydrate|glucose|fructose|sucrose|maltose|lactose|starch|cellulose|glycogen|reducing sugar|anomers|monosaccharide|disaccharide|polysaccharide|invert sugar',
      'Proteins & Enzymes': 'amino acid|peptide bond|protein|enzyme|zwitter ion|isoelectric point|denaturation of protein|primary structure of protein|secondary structure of protein|tertiary structure|alpha helix|beta sheet',
      'Vitamins & Nucleic Acids': 'vitamin|fat soluble vitamin|water soluble vitamin|ascorbic acid|retinol|nucleic acid|nucleotide|nucleoside|dna structure|double helix|rna|base pairing|genetic code|hormone|harmonic secretion',
    }),
    Polymers: C('polymer|monomer|addition polymerisation|condensation polymerisation|copolymer|natural rubber|vulcanisation|vulcanization|nylon|bakelite|pvc|polythene|biodegradable polymer|polymerisation|polymerization', {
      'Types of Polymerisation': 'addition polymerisation|addition polymerization|condensation polymerisation|condensation polymerization|copolymer|chain growth polymerisation|step growth polymerisation|free radical polymerisation',
      'Some Important Polymers': 'polymer|monomer|natural rubber|vulcanisation|vulcanization|nylon|nylon 6|nylon 6 6|bakelite|pvc|polythene|teflon|dacron|polystyrene|buna s|buna n|neoprene|low density polythene|high density polythene',
      'Biodegradable & Industrial': 'biodegradable polymer|polymer in medicine|poly hydroxybutyrate|phbv|synthetic polymer industry|disadvantage of non biodegradable',
    }),
    'Chemistry in Everyday Life': C('drug|medicine|antacid|antihistamine|tranquilizer|analgesic|antibiotic|detergent|artificial sweetener|food preservative|soap|cleansing agent|antiseptic|disinfectant', {
      'Drugs & Medicines': 'drug|medicine|antacid|antihistamine|tranquilizer|tranquillizer|analgesic|antibiotic|antimicrobial|antifertility drug|narcotic|drug abuse|side effect of drug|receptor binding|enzyme inhibition by drug',
      'Chemicals in Food': 'artificial sweetener|sweetening agent|food preservative|antioxidant in food|edible colour|saccharin|aspartame',
      'Cleansing Agents': 'detergent|soap|cleansing agent|anionic detergent|cationic detergent|non ionic detergent|synthetic detergent|soapless detergent|hard water and soap|biodegradable detergent',
    }),
    'Nuclear Chemistry': C('nuclear chemistry|radioactive element|nuclear reaction|group displacement law|nuclear transmutation|nuclide|artificial radioactivity|mass defect in nucleus|nuclear binding', {
      'Radioactivity & Decay': 'nuclear chemistry|radioactive element|radioactive decay law|group displacement law|soddy|disintegration constant|artificial radioactivity|induced radioactivity',
      'Nuclear Reactions': 'nuclear reaction|nuclear transmutation|nuclide|bombardment of|neutron capture|nuclear fission reaction|nuclear fusion reaction|binding energy per nucleon curve',
    }),
    'Surface Chemistry': C('adsorption|adsorbent|colloid|tyndall effect|brownian movement|coagulation of colloid|emulsion|micelle|physisorption|chemisorption|electrophoresis|hardy schulze rule|peptisation', {
      'Adsorption': 'adsorption|adsorbent|adsorbate|physisorption|chemisorption|adsorption isotherm|freundlich isotherm|langmuir|application of adsorption|catalysis by adsorption',
      'Colloids': 'colloid|colloidal solution|tyndall effect|brownian movement|coagulation of colloid|emulsion|micelle|electrophoresis|hardy schulze rule|peptisation|sol|gel|aerosol|hydrosol|protective colloid|gold number',
    }),
    'Metals & Metallurgy': C('metallurgy|ore|mineral|calcination|roasting|smelting|refining of metal|blister copper|pig iron|wrought iron|steel making|thermite reaction|extraction of metal|gangue|flux|slag', {
      'Extraction Principles': 'metallurgy|ore|mineral|calcination|roasting|smelting|gangue|flux|slag|reduction of metal oxide|thermite reaction|aluminothermite|self reduction',
      'Metallurgy of Specific Metals': 'extraction of iron|extraction of aluminium|extraction of copper|blister copper|pig iron|wrought iron|steel making|bessemer|open hearth|extraction of zinc|extraction of silver|refining of metal|electrolytic refining|zone refining|vapour phase refining',
      'Corrosion & Alloys': 'corrosion|rusting of iron|galvanisation|galvanization|alloy|brass|bronze|solder|duralumin|stainless steel|cathodic protection',
    }),
  }),

  Biology: C('biology|biological', {
    'Diversity in the Living World': C('taxonomic|hierarchy of classification|binomial nomenclature|five kingdom|monera|fungi|protista|plant kingdom|animal kingdom|virus|bacteria|lichen|herbarium|botanical garden|museum|zoological park|species concept|identification of organism', {
      'Taxonomy & Systematics': 'taxonomic|taxonomy|systematics|hierarchy of classification|taxonomic category|binomial nomenclature|generic name|specific epithet|identification of organism|nomenclature',
      'Five Kingdom Classification': 'five kingdom|monera|protista|fungi|plantae|animalia|whittaker|two kingdom|viruses|viroids|lichens|prions',
      'Plant & Animal Kingdoms': 'plant kingdom|algae|bryophyta|pteridophyta|gymnosperm|angiosperm|animal kingdom|porifera|cnidaria|platyhelminthes|nematoda|annelida|arthropoda|mollusca|echinodermata|chordata|non chordate|vertebrata',
    }),
    'Cell: Structure & Function': C('cell organelle|organelle|mitochondria|ribosome|chloroplast|golgi apparatus|lysosome|endoplasmic reticulum|plasma membrane|cell wall|nucleus|chromosome|cell cycle|mitosis|meiosis|cell division|prokaryotic cell|eukaryotic cell', {
      'Cell Organelles': 'cell organelle|organelle|mitochondria|powerhouse|ribosome|chloroplast|golgi apparatus|golgi body|lysosome|suicidal bag|endoplasmic reticulum|rough er|smooth er|plastid|centrosome|vacuole|microbody|peroxisome',
      'Cell Membrane & Wall': 'plasma membrane|cell wall|fluid mosaic|passive transport|active transport|osmosis in cell|plasmolysis|cell membrane transport',
      'Cell Cycle & Division': 'cell cycle|mitosis|meiosis|prophase|metaphase|anaphase|telophase|synapsis|crossing over in meiosis|dna replication|cell division|karyokinesis|cytokinesis|chromosome number',
      'Biomolecules of Cell': 'amino acid in cell|nucleic acid in cell|protein in cell|enzyme in cell|carbohydrate in cell|lipid in cell|primary and secondary metabolite',
    }),
    'Structural Organisation in Plants & Animals': C('morphology of flowering plant|anatomy of flowering plant|root system|stem anatomy|leaf anatomy|xylem|phloem|tissue system|animal tissue|epithelial tissue|connective tissue|muscular tissue|nervous tissue|cockroach|frog morphology', {
      'Plant Tissues & Anatomy': 'morphology of flowering plant|anatomy of flowering plant|root system|modifications of root|stem modification|leaf venation|inflorescence|xylem|phloem|cambium|parenchyma|collenchyma|sclerenchyma|vascular bundle|monocot stem|dicot root|secondary growth|annual ring',
      'Animal Tissues': 'animal tissue|epithelial tissue|connective tissue|muscular tissue|nervous tissue|cartilage|bone tissue|blood tissue|areolar tissue|adipose',
      'Morphology of Animals': 'cockroach|frog|earthworm|morphology of animals|digestive system of cockroach|nervous system of cockroach|reproductive system of frog',
    }),
    'Plant Physiology': C('photosynthesis|transpiration|respiration in plants|auxin|gibberellin|plant hormone|seed germination|photoperiodism|mineral nutrition in plants|nitrogen metabolism|ascent of sap|water relation of plant|opening and closing of stomata', {
      'Photosynthesis': 'photosynthesis|light reaction|dark reaction|calvin cycle|c4 pathway|photorespiration|chlorophyll absorption|photosynthetic pigment|quantum requirement|kranz anatomy',
      'Respiration in Plants': 'respiration in plants|glycolysis|krebs cycle|electron transport chain|fermentation in plant|atp synthesis in mitochondria|respiratory quotient|oxidative phosphorylation',
      'Plant Growth & Hormones': 'auxin|gibberellin|cytokinin|abscisic acid|ethylene|plant hormone|plant growth regulator|seed germination|photoperiodism|vernalisation|dormancy of seed|bolting|apical dominance',
      'Transport & Water Relations': 'transpiration|ascent of sap|water relation of plant|water potential|plasmolysis in plant|opening and closing of stomata|translocation of food|imbibition|xylem transport|root pressure|guttation',
      'Mineral Nutrition': 'mineral nutrition in plants|nitrogen metabolism|nitrogen fixation|nodule formation|essential mineral element|deficiency symptom in plant|hydroponics|nitrification|mycorrhiza',
    }),
    'Human Physiology': C('digestion|breathing|circulation of blood|blood|heart|excretion|kidney|neuron|nervous system|endocrine gland|hormone secretion|locomotion|muscle contraction|immunity|respiration in human|gas exchange', {
      'Digestion & Absorption': 'digestion|digestive system|alimentary canal|digestive enzyme|absorption of food|peristalsis|digestive juice|bile|pepsin|trypsin|emulsification of fat|disorder of digestive',
      'Breathing & Respiration': 'breathing|respiration in human|respiratory system|gas exchange|alveoli|tidal volume|lung volume|inspiratory capacity|respiratory disorder|asthma|emphysema|partial pressure of oxygen|haemoglobin oxygen',
      'Body Fluids & Circulation': 'circulation of blood|blood|heart|cardiac cycle|heartbeat|blood pressure|ecg|blood clotting|coagulation of blood|plasma|serum|blood group|rh factor|platelet|wbc|rbc|anaemia|blood vessel|artery|vein|capillary|lymph',
      'Excretory System': 'excretion|kidney|nephron|urine formation|glomerular filtration|selective reabsorption|dialysis|kidney disorder|renal failure|antidiuretic|micturition|urea cycle',
      'Locomotion & Movement': 'locomotion|muscle contraction|skeletal muscle|sliding filament|actin|myosin|bone joint|types of joint|arthritis|osteoporosis|muscle fatigue|rigor mortis',
      'Neural Control & Coordination': 'neuron|nervous system|nerve impulse|synapse|action potential|resting potential|axon|dendrite|central nervous system|brain|spinal cord|reflex action|reflex arc|neurotransmitter|grey matter|white matter|disorder of nervous',
      'Chemical Coordination': 'endocrine gland|hormone secretion|thyroid|insulin|adrenal|pituitary|hypothalamus|hormone action|diabetes mellitus|goitre|cretinism|adrenaline|cortisol|feedback mechanism',
      'Immunity & Human Health': 'immunity|immune system|antibody|antigen|vaccination|pathogen|disease causing organism|aids|hiv|malaria parasite|dengue|typhoid|pneumonia|common cold|immunisation|active immunity|passive immunity|lymphoid organ|allergy|autoimmune',
    }),
    Reproduction: C('reproduction in organism|asexual reproduction|sexual reproduction|pollination|fertilisation|embryogenesis|human reproduction|menstrual cycle|gametogenesis|reproductive health|contraception|parturition|lactation', {
      'Reproduction in Organisms': 'reproduction in organism|asexual reproduction|vegetative propagation|binary fission|budding|spore formation|sexual reproduction|lifespan of organism|offspring',
      'Reproduction in Flowering Plants': 'pollination|fertilisation|double fertilisation|microsporogenesis|megasporogenesis|embryo sac|endosperm|apomixis|polyembryony|pollen tube|self pollination|cross pollination|wind pollination|water pollination|artificial hybridisation|emasculation',
      'Human Reproduction': 'human reproduction|menstrual cycle|menstrual phase|ovulation|gametogenesis|spermatogenesis|oogenesis|male reproductive system|female reproductive system|placenta|gestation|parturition|lactation|implantation|blastocyst',
      'Reproductive Health': 'reproductive health|contraception|contraceptive method|iud|oral pill|vasectomy|tubectomy|safe period|artificial insemination|ivf|test tube baby|zift|surrogate|sexually transmitted disease|std|amniocentesis',
    }),
    'Genetics & Evolution': C('genetics|mendel|gene interaction|allelic interaction|dihybrid cross|law of dominance|linkage|crossing over|genetic disorder|mutation|dna as genetic material|transcription|translation|genetic code|evolution|darwin|natural selection|hardy weinberg principle|speciation|evidence of evolution', {
      'Mendelian Genetics': 'genetics|mendel|mendelian inheritance|dihybrid cross|monohybrid cross|law of dominance|law of segregation|law of independent assortment|test cross|back cross|punnett square|phenotypic ratio|genotypic ratio|incomplete dominance|codominance|multiple allelism|pleiotropy|epistasis|polygenic inheritance',
      'Chromosomal Basis & Linkage': 'linkage|crossing over|recombination frequency|chromosomal theory|sex determination|sex linked inheritance|haemophilia|color blindness|colour blindness|turner syndrome|klinefelter|down syndrome|chromosomal disorder|aneuploidy|polyploidy',
      'Molecular Basis of Inheritance': 'dna as genetic material|structure of dna|double helix model|watson and crick|replication of dna|semi conservative replication|transcription|translation|genetic code|operon|lac operon|rna polymerase|ribosome site|central dogma|mutation|mutagen|silent mutation|frameshift',
      'Evolution': 'evolution|darwin|natural selection|survival of the fittest|hardy weinberg principle|hardy weinberg equilibrium|speciation|adaptive radiation|convergent evolution|homologous organ|analogous organ|vestigial organ|evidence of evolution|fossil evidence|molecular evolution|industrial melanism|gene flow|genetic drift|founder effect|origin of life|miller urey',
    }),
    'Biotechnology & Its Applications': C('biotechnology|recombinant dna|plasmid|restriction enzyme|pcr|cloning vector|transgenic|gene therapy|biotechnological application|recombinant vaccine|insulin production|b t cotton|rna interference', {
      'Principles & Processes': 'biotechnology|recombinant dna|plasmid|restriction enzyme|restriction endonuclease|palindromic sequence|pcr|polymerase chain reaction|cloning vector|cloning sites|transformant|competent cell|bioreactor|downstream processing|elisa',
      'Applications': 'recombinant vaccine|insulin production|gene therapy|transgenic animal|transgenic plant|b t cotton|cry gene|rna interference|pest resistant plant|golden rice|gene doping|dna fingerprinting|paternity testing|forensic application|molecular diagnosis',
    }),
    'Ecology & Environment': C('ecosystem|food chain|food web|ecological pyramid|energy flow|biodiversity|conservation of biodiversity|population interaction|mutualism|parasitism|pollution|ozone depletion|greenhouse effect|population growth|biomes|ecological succession|habitat|endangered species|national park', {
      'Ecosystem': 'ecosystem|food chain|food web|ecological pyramid|energy flow|trophic level|primary productivity|decomposer|food web complexity|ecosystem service|pyramid of energy|pyramid of biomass|pyramid of number|nutrient cycling|carbon cycle|phosphorus cycle|nitrogen cycle',
      'Biodiversity & Conservation': 'biodiversity|conservation of biodiversity|endangered species|endemic species|hotspot of biodiversity|in situ conservation|ex situ conservation|national park|wildlife sanctuary|biosphere reserve|red data book|extinction of species|seed bank|cryopreservation',
      'Organisms & Populations': 'population interaction|mutualism|parasitism|commensalism|amensalism|competition in ecology|predation|population growth|exponential growth|logistic growth|carrying capacity|population density|age pyramid|birth rate and death rate|migration in ecology|adaptation of organism|camouflage',
      'Environmental Issues': 'pollution|air pollution|water pollution|soil pollution|noise pollution|solid waste|e waste|radioactive waste|ozone depletion|greenhouse effect|global warming|acid rain|biomagnification|eutrophication|algal bloom|deforestation|afforestation|biological amplification',
    }),
  }),
}

// ── Text normalisation for classification ───────────────────────────────────

/**
 * Lowercase fold of question + solution text that keeps the notation the
 * parser already produced ('dy/dx', 'x^2', 'sn1', 'v t graph') while dropping
 * everything else that is not a letter, digit, caret or slash.
 */
const normalizeForClassification = (raw) =>
  String(raw || '')
    .replace(/∫/g, ' integral ')
    .replace(/Σ|∑/g, ' sigma ')
    .replace(/√/g, ' sqrt ')
    .replace(/π/g, ' pi ')
    .replace(/θ/g, ' theta ')
    .replace(/Δ|∆/g, ' delta ')
    .replace(/λ/g, ' lambda ')
    .replace(/µ|μ/g, ' mu ')
    .replace(/Ω/g, ' ohm ')
    .toLowerCase()
    .replace(/[^a-z0-9^/\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Compile one keyword for matching. Single words are matched through a token
 * set (with simple plural tolerance); multi-word phrases use a regex with
 * flexible whitespace.
 */
const compileKeyword = (word) => {
  const escaped = word
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+')
  return {
    re: new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`),
    simple: word.indexOf(' ') === -1 ? word : null,
    weight: 1 + word.length / 10,
    word,
  }
}

/** Compiled form of the taxonomy, built once at module load. */
const COMPILED = (() => {
  const subjects = {}
  for (const [subjectName, subjectDef] of Object.entries(CET_SYLLABUS)) {
    const chapters = {}
    for (const [chapterName, chapterDef] of Object.entries(subjectDef.topics)) {
      const topics = {}
      for (const [topicName, topicValue] of Object.entries(chapterDef.topics || {})) {
        const spec = Array.isArray(topicValue)
          ? { k: topicValue, s: {} }
          : typeof topicValue === 'string'
            ? { k: K(topicValue), s: {} }
            : { k: K(topicValue.k), s: topicValue.s || {} }
        const subTopics = {}
        for (const [subName, subKeywords] of Object.entries(spec.s)) {
          subTopics[subName] = K(subKeywords).map(compileKeyword)
        }
        topics[topicName] = { keywords: spec.k.map(compileKeyword), subTopics }
      }
      chapters[chapterName] = { keywords: (chapterDef.keywords || []).map(compileKeyword), topics }
    }
    subjects[subjectName] = { chapters }
  }
  return subjects
})()

// ── Scoring helpers ─────────────────────────────────────────────────────────

/** Token set for fast single-word keyword lookup (with plural tolerance). */
const tokenize = (text) => {
  const tokens = new Set()
  for (const word of text.split(' ')) {
    if (!word) continue
    tokens.add(word)
    if (/(s|es)$/.test(word)) {
      // plural -> singular tolerance: taxonomy keywords are stored singular
      if (word.length > 3) tokens.add(word.slice(0, -1))
      if (word.endsWith('es') && word.length > 4) tokens.add(word.slice(0, -2))
    } else {
      tokens.add(`${word}s`)
      tokens.add(`${word}es`)
    }
  }
  return tokens
}

const scoreKeywordSet = (text, tokens, compiled) => {
  let score = 0
  let hits = 0
  for (const entry of compiled) {
    const matched = entry.simple
      ? tokens.has(entry.simple)
      : entry.re.test(text)
    if (matched) {
      score += entry.weight
      hits += 1
    }
  }
  return { score, hits }
}

const SUBJECT_ALIASES = {
  math: 'Mathematics',
  maths: 'Mathematics',
  mathematics: 'Mathematics',
  physics: 'Physics',
  chemistry: 'Chemistry',
  biology: 'Biology',
  botany: 'Biology',
  zoology: 'Biology',
}

/** Map a subject printed in the PDF ('Math', 'BOTANY') to a syllabus subject. */
const canonicalSubject = (value) => {
  const key = String(value || '').toLowerCase().replace(/[^a-z]/g, '')
  return SUBJECT_ALIASES[key] || null
}

const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Best taxonomy entry whose name matches a free-text label from the PDF. */
const matchByName = (names, label) => {
  if (!label) return null
  const target = normName(label)
  if (!target) return null
  for (const name of names) {
    if (normName(name) === target) return name
  }
  // token containment: every word of the label appears in the taxonomy name
  const tokens = target.split(/[^a-z0-9]+/).filter((t) => t.length > 1)
  for (const name of names) {
    const nn = normName(name)
    if (tokens.length && tokens.every((t) => nn.includes(t))) return name
  }
  return null
}

// ── Question-type / difficulty / relevance heuristics ───────────────────────

const GRAPH_SIGNAL = /(?<![a-z0-9])(graph|graphs|graphically|graph shown|velocity time graph|v t graph|p v diagram|indicator diagram)(?![a-z0-9])/
const DIAGRAM_SIGNAL = /(?<![a-z0-9])(diagram|figure|fig|free body diagram|shown below|shown in the figure|drawn below)(?![a-z0-9])/
const COMPUTE_SIGNAL = /(calculate|find|evaluate|compute|determine|how many|how much|the value of|sum of|difference between|total number|is equal to)/
const NUMERIC_PATTERN = /\d/
const UNIT_SIGNAL = /( m s | m s2 | m\/s | m\/s2 | km\/h | kg | km | cm | mm | metre | meter | second | minute | hour | newton | joule | watt | ampere | volt | ohm | mole | mol | gram | gm | g | litre | liter | celsius | kelvin | hz | calorie | kcal | dyne | erg | m )/
const APPLICATION_SIGNAL = /(car|cars|train|bus|truck|tower|building|buildings|ladder|person|boy|girl|man|woman|student|player|ball|stone|projectile|lift|elevator|road|river|swimmer|boat|ship|aeroplane|airplane|pole|tree|shadow|machine|engine|cycle|bicycle|bucket|rope|wire|bridge|field|garden|shop|market|cricket|hockey)/
const FORMULA_SIGNAL = /(formula|relation between|related as|using the equation|according to the relation|derive|derivation|expression for)/
const MULTI_STEP_SIGNAL = /(and then|then find|then calculate|also find|first find|further|subsequently)/

/** CET question type from textual evidence (checked in priority order). */
const detectQuestionType = (stem, multiConcept) => {
  if (GRAPH_SIGNAL.test(stem)) return 'Graph Based'
  if (DIAGRAM_SIGNAL.test(stem)) return 'Diagram Based'
  if (multiConcept) return 'Multi-Concept'
  const numerical = NUMERIC_PATTERN.test(stem) && (COMPUTE_SIGNAL.test(stem) || UNIT_SIGNAL.test(stem) || /\b(is|are)\s*$/.test(stem))
  if (numerical) return 'Numerical'
  if (APPLICATION_SIGNAL.test(stem)) return 'Application Based'
  if (FORMULA_SIGNAL.test(stem)) return 'Formula Based'
  return 'Conceptual'
}

/** CET difficulty score -> level (Easy, Moderate, Hard, Very Hard). */
const detectCetDifficulty = (stem, questionType, multiConcept) => {
  let score = 0
  if (questionType === 'Multi-Concept') score += 1.5
  else if (questionType === 'Numerical' || questionType === 'Graph Based' || questionType === 'Diagram Based') score += 1
  else if (questionType === 'Application Based') score += 1

  const words = stem.split(' ').filter(Boolean).length
  if (words > 35) score += 0.5
  if (words > 60) score += 0.5

  const numbers = stem.match(/\d+(?:\.\d+)?/g) || []
  if (numbers.length >= 3) score += 0.5
  if (/\d+\.\d+/.test(stem)) score += 0.5
  if (MULTI_STEP_SIGNAL.test(stem)) score += 0.5
  if (multiConcept) score += 0.25

  // score bands: 0 -> Easy, 1.x -> Moderate, 2.x -> Hard, >=3 -> Very Hard
  const idx = Math.max(0, Math.min(3, Math.floor(score)))
  return CET_DIFFICULTY_LEVELS[idx]
}

// ── Core classifier ─────────────────────────────────────────────────────────

// Minimum keyword evidence required at each level of the taxonomy
const MIN_SUBJECT_SCORE = 1.4
const MIN_CHAPTER_SCORE = 1.4
const MIN_TOPIC_SCORE = 1.2
const MIN_SUBTOPIC_SCORE = 1.2

/**
 * Classify one extracted question against the MHT-CET syllabus.
 *
 * @param {object} q parsed question ({ question, options, solution, subject, chapter, topic, difficulty })
 * @returns classification fields (subject/chapter/topic/subTopic/questionType/
 *          cetDifficulty/cetRelevance/classificationConfidence/classificationSource)
 */
const classifyQuestion = (q) => {
  // Question text carries the strongest signal; options and solution add the
  // discriminative vocabulary conceptual questions rely on.
  const optionText = q.options && typeof q.options === 'object' ? Object.values(q.options).join(' ') : ''
  const stemText = normalizeForClassification([q.question, q.solution].filter(Boolean).join(' '))
  const stemTokens = tokenize(stemText)
  const text = normalizeForClassification([q.question, optionText, q.solution].filter(Boolean).join(' '))
  const tokens = tokenize(text)
  const hintSubject = canonicalSubject(q.subject)

  // 1. Score every subject through its chapters. Topic-level keywords fold
  //    into the chapter score (a topic hit is chapter evidence too).
  const subjectResults = []
  for (const [subjectName, subjectDef] of Object.entries(COMPILED)) {
    const chapters = []
    let total = 0
    for (const [chapterName, chapterDef] of Object.entries(subjectDef.chapters)) {
      const kw = scoreKeywordSet(text, tokens, chapterDef.keywords)
      let bestTopicScore = 0
      for (const topicDef of Object.values(chapterDef.topics)) {
        const t = scoreKeywordSet(text, tokens, topicDef.keywords)
        if (t.score > bestTopicScore) bestTopicScore = t.score
      }
      const score = kw.score + bestTopicScore * 1.2
      if (score > 0) {
        chapters.push({ name: chapterName, score, hits: kw.hits })
        total += score
      }
    }
    chapters.sort((a, b) => b.score - a.score)
    if (hintSubject === subjectName) total += 8 // explicit "Subject:" line in the PDF
    else if (hintSubject) total *= 0.35 // printed subject outranks cross-subject noise
    subjectResults.push({ name: subjectName, total, chapters })
  }
  subjectResults.sort((a, b) => b.total - a.total)

  const bestSubject = subjectResults[0]
  const subjectDetected = Boolean(bestSubject && bestSubject.total >= MIN_SUBJECT_SCORE)

  // 2. Chapter / topic / sub-topic within the winning subject
  let pdfChapterMatched = false
  let pdfTopicMatched = false
  let chapter = ''
  let topic = ''
  let subTopic = ''
  let chapterScore = 0
  let multiConcept = false

  if (subjectDetected) {
    const chapterNames = Object.keys(COMPILED[bestSubject.name].chapters)
    const pdfChapter = matchByName(chapterNames, q.chapter)
    const scored = bestSubject.chapters

    if (pdfChapter) {
      chapter = pdfChapter
      chapterScore = (scored.find((c) => c.name === pdfChapter) || { score: 2 }).score
      pdfChapterMatched = true
    } else if (scored.length && scored[0].score >= MIN_CHAPTER_SCORE) {
      chapter = scored[0].name
      chapterScore = scored[0].score
    }

    // Multi-concept: two strong chapters contribute evidence in the question
    // stem itself (options are answer choices, not task evidence)
    if (subjectDetected && scored.length >= 2 && scored[0].score >= 3 && scored[1].score >= 0.6 * scored[0].score && scored[1].score >= 2.5) {
      const stemScore = (chapterName) => {
        const def = COMPILED[bestSubject.name].chapters[chapterName]
        const kw = scoreKeywordSet(stemText, stemTokens, def.keywords)
        let bestTopicScore = 0
        for (const topicDef of Object.values(def.topics)) {
          const t = scoreKeywordSet(stemText, stemTokens, topicDef.keywords)
          if (t.score > bestTopicScore) bestTopicScore = t.score
        }
        return kw.score + bestTopicScore * 1.2
      }
      multiConcept = stemScore(scored[0].name) >= MIN_CHAPTER_SCORE && stemScore(scored[1].name) >= MIN_CHAPTER_SCORE
    }

    if (chapter) {
      const topicsDef = COMPILED[bestSubject.name].chapters[chapter].topics
      const topicNames = Object.keys(topicsDef)
      const pdfTopic = matchByName(topicNames, q.topic)
      if (pdfTopic) {
        topic = pdfTopic
        pdfTopicMatched = true
      } else {
        let bestTopic = null
        for (const [topicName, topicDef] of Object.entries(topicsDef)) {
          const { score } = scoreKeywordSet(text, tokens, topicDef.keywords)
          if (score > 0 && (!bestTopic || score > bestTopic.score)) bestTopic = { name: topicName, score }
        }
        if (bestTopic && bestTopic.score >= MIN_TOPIC_SCORE) topic = bestTopic.name
      }
      if (topic) {
        const subTopicsDef = topicsDef[topic].subTopics
        let bestSub = null
        for (const [subName, compiled] of Object.entries(subTopicsDef)) {
          const { score } = scoreKeywordSet(text, tokens, compiled)
          if (score > 0 && (!bestSub || score > bestSub.score)) bestSub = { name: subName, score }
        }
        if (bestSub && bestSub.score >= MIN_SUBTOPIC_SCORE) subTopic = bestSub.name
      }
    }
  }

  // 3. CET question type + difficulty (from the stem, not the answer options)
  const questionType = detectQuestionType(stemText, multiConcept)
  const pdfDifficulty = String(q.difficulty || '').toLowerCase()
  let cetDifficulty
  if (pdfDifficulty === 'easy') cetDifficulty = 'Easy'
  else if (pdfDifficulty === 'medium' || pdfDifficulty === 'moderate') cetDifficulty = 'Moderate'
  else if (pdfDifficulty === 'hard' || pdfDifficulty === 'difficult') cetDifficulty = 'Hard'
  else cetDifficulty = detectCetDifficulty(stemText, questionType, multiConcept)

  // 4. CET relevance against the syllabus map
  let cetRelevance
  if (chapter) cetRelevance = 'Highly Relevant'
  else if (subjectDetected) cetRelevance = 'Relevant'
  else if (hintSubject) cetRelevance = 'Partially Relevant'
  else cetRelevance = 'Not Relevant'

  // 5. Merge with whatever the PDF printed: PDF labels win when present
  const usedPdfMetadata = Boolean(hintSubject || pdfChapterMatched || pdfTopicMatched)
  let subject = subjectDetected ? bestSubject.name : ''
  if (hintSubject) subject = hintSubject
  if (!chapter && q.chapter && hintSubject) {
    chapter = String(q.chapter) // keep the PDF chapter verbatim
    if (!topic && q.topic) topic = String(q.topic) // keep the PDF topic verbatim
  }

  // 6. Confidence
  let confidence = 0.25
  if (subjectDetected) confidence += 0.25
  if (chapter) confidence += 0.25
  if (topic) confidence += 0.1
  if (subTopic) confidence += 0.05
  if (usedPdfMetadata) confidence += 0.15
  confidence += Math.min(0.1, chapterScore / 40)
  confidence = Math.max(0.05, Math.min(0.97, Math.round(confidence * 100) / 100))

  return {
    subject,
    chapter,
    topic,
    subTopic,
    questionType,
    cetDifficulty,
    cetRelevance,
    classificationConfidence: confidence,
    classificationSource: subject ? (usedPdfMetadata ? 'pdf' : 'rules') : '',
  }
}

/**
 * Batch classification for the PDF import pipeline.
 *
 * Decorates every question with the CET classification and the source PDF name.
 * Existing parser fields are never removed; subject/chapter/topic are refined.
 *
 * @param {Array} questions parsed questions from pdfQuestionParser
 * @param {object} [opts]
 * @param {string} [opts.sourcePdf] original file name for source tracking
 */
const classifyQuestions = (questions, { sourcePdf } = {}) =>
  (questions || []).map((q) => {
    const classification = classifyQuestion(q)
    return {
      ...q,
      ...classification,
      sourcePdf: String(sourcePdf || q.sourcePdf || ''),
    }
  })

// ── Distribution analysis ───────────────────────────────────────────────────

const UNCLASSIFIED = 'Not Identified'

const pct = (count, total) => (total > 0 ? Math.round((count / total) * 1000) / 10 : 0)

const distributionOf = (values) => {
  const total = values.length
  const counts = new Map()
  values.forEach((v) => counts.set(v || UNCLASSIFIED, (counts.get(v || UNCLASSIFIED) || 0) + 1))
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count, percent: pct(count, total) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/**
 * Build the PDF analysis: subject / chapter / topic / sub-topic tree plus
 * difficulty, CET relevance and question-type distributions.
 *
 * @param {Array} questions classified questions
 */
const buildAnalysis = (questions) => {
  const list = questions || []
  const total = list.length

  const tree = []
  const chaptersBySubject = {}

  const subjects = distributionOf(list.map((q) => q.subject))
  subjects.forEach(({ name }) => {
    const inSubject = list.filter((q) => (q.subject || UNCLASSIFIED) === name)
    if (name === UNCLASSIFIED) {
      tree.push({ name, count: inSubject.length, percent: pct(inSubject.length, total), chapters: [] })
      return
    }
    const chapterEntries = distributionOf(inSubject.map((q) => q.chapter))
    chaptersBySubject[name] = chapterEntries

    const chapters = chapterEntries.map(({ name: chapterName }) => {
      const inChapter = inSubject.filter((q) => (q.chapter || UNCLASSIFIED) === chapterName)
      const topicEntries = distributionOf(inChapter.map((q) => q.topic))
      const topics = topicEntries.map(({ name: topicName }) => {
        const inTopic = inChapter.filter((q) => (q.topic || UNCLASSIFIED) === topicName)
        const subTopicEntries = distributionOf(inTopic.map((q) => q.subTopic))
        return { name: topicName, count: inTopic.length, percent: pct(inTopic.length, total), subTopics: subTopicEntries }
      })
      return { name: chapterName, count: inChapter.length, percent: pct(inChapter.length, total), topics }
    })

    tree.push({ name, count: inSubject.length, percent: pct(inSubject.length, total), chapters })
  })

  return {
    totalQuestions: total,
    classified: list.filter((q) => q.subject).length,
    unclassified: total - list.filter((q) => q.subject).length,
    subjects,
    chaptersBySubject,
    tree,
    difficulty: distributionOf(list.map((q) => q.cetDifficulty)),
    cetRelevance: distributionOf(list.map((q) => q.cetRelevance)),
    questionTypes: distributionOf(list.map((q) => q.questionType)),
  }
}

/** Taxonomy for the admin dropdowns (GET /api/questions/meta/cet-taxonomy). */
const getCetTaxonomy = () =>
  Object.entries(CET_SYLLABUS).map(([subjectName, subjectDef]) => ({
    name: subjectName,
    chapters: Object.entries(subjectDef.topics).map(([chapterName, chapterDef]) => ({
      name: chapterName,
      topics: Object.entries(chapterDef.topics || {}).map(([topicName, topicValue]) => {
        const spec = Array.isArray(topicValue)
          ? { s: {} }
          : typeof topicValue === 'string'
            ? { s: {} }
            : { s: topicValue.s || {} }
        return { name: topicName, subTopics: Object.keys(spec.s) }
      }),
    })),
  }))

module.exports = {
  CET_SYLLABUS,
  QUESTION_TYPES,
  CET_RELEVANCE_LEVELS,
  CET_DIFFICULTY_LEVELS,
  CLASSIFICATION_SOURCES,
  classifyQuestion,
  classifyQuestions,
  buildAnalysis,
  getCetTaxonomy,
  normalizeForClassification,
  canonicalSubject,
  UNCLASSIFIED,
}
