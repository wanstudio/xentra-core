const EventContract = require('./EventContract');
const EventContext = require('./EventContext');
const EventBus = require('./EventBus');
const EventPublisher = require('./EventPublisher');
const EventSubscriber = require('./EventSubscriber');
const EventDispatcher = require('./EventDispatcher');
const EventRegistry = require('./EventRegistry');
const EventLogger = require('./EventLogger');

module.exports = {
  EventContract,
  EventContext,
  EventBus,
  EventPublisher,
  EventSubscriber,
  EventDispatcher,
  EventRegistry,
  EventLogger,

  // Convenience Factory Methods
  createEventBus: () => new (EventBus.EventBus || EventBus.constructor || EventBus)(),
  createPublisher: (domain, customBus) => new EventPublisher(domain, customBus),
  createSubscriber: (domain, customBus) => new EventSubscriber(domain, customBus),
  createContext: (params) => new EventContext(params),
  createLogger: (storage) => new EventLogger(storage)
};
