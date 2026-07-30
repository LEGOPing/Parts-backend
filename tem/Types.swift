//
//  Types.swift
//  PARTS
//
//  Created by Guo Ping Hu on 2026/2/27.
//

import CoreData
import SwiftUI

// View 扩展，添加 eraseToAnyView 方法
extension View {
    func eraseToAnyView() -> AnyView {
        return AnyView(self)
    }
}

// 零件型号和名称的数据结构
struct PartSuggestion: Hashable {
    let number: String
    let name: String
    
    func hash(into hasher: inout Hasher) {
        hasher.combine(number)
    }
    
    static func ==(lhs: PartSuggestion, rhs: PartSuggestion) -> Bool {
        return lhs.number == rhs.number
    }
}

// 零件型号联想功能
enum PartNumberSuggestionManager {
    // 数据源类型
    enum DataSource: Equatable, Sendable {
        case system // 系统数据库
        case rb // RB数据库
        
        static func == (lhs: DataSource, rhs: DataSource) -> Bool {
            switch (lhs, rhs) {
            case (.system, .system), (.rb, .rb):
                return true
            default:
                return false
            }
        }
    }
    
    // 缓存变量，用于存储零件型号和名称列表，避免重复数据库查询
    private static var cachedParts: [PartNumberSuggestionManager.DataSource: [PartSuggestion]] = [:]
    
    // 缓存有效期（秒）
    private static let cacheExpiryInterval: TimeInterval = 3600 // 1小时
    
    // 缓存时间戳
    private static var cacheTimestamps: [PartNumberSuggestionManager.DataSource: Date] = [:]
    
    // 确保线程安全的访问
    private static let cacheQueue = DispatchQueue(label: "com.partnumber.suggestion.cache")
    
    // 获取所有零件型号和名称（带缓存）
    private static func getAllParts(dataSource: PartNumberSuggestionManager.DataSource) -> [PartSuggestion] {
        return cacheQueue.sync {
            // 检查缓存是否有效
            if let cachedParts = cachedParts[dataSource], 
               let timestamp = cacheTimestamps[dataSource], 
               Date().timeIntervalSince(timestamp) < cacheExpiryInterval {
                print("使用缓存的零件数据，数量: \(cachedParts.count)")
                return cachedParts
            }
            
            print("开始从\(dataSource == .system ? "系统数据库" : "RB数据库")获取零件数据...")
            
            // 根据数据源选择不同的实体和上下文
            let entityName: String
            let context: NSManagedObjectContext
            let persistence = PersistenceController.shared
            
            switch dataSource {
            case .system:
                entityName = "Part"
                context = persistence.container.viewContext
            case .rb:
                entityName = "Parts"
                context = persistence.rbContainer.viewContext
            }
            
            // 创建查询请求
            let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: entityName)
            
            // 只获取part_num和name属性，提高性能
            fetchRequest.propertiesToFetch = ["part_num", "name"]
            
            // 限制批量获取大小，提高性能
            fetchRequest.fetchBatchSize = 100
            
            // 取消RB数据库的结果数量限制，使用批量获取和分页处理
            // fetchRequest.fetchLimit = 1000
            
            // 执行查询
            var parts: [NSManagedObject]?
            do {
                parts = try context.fetch(fetchRequest)
                print("成功获取零件数据，数量: \(parts?.count ?? 0)")
            } catch {
                print("获取零件数据失败: \(error)")
            }
            
            // 提取零件型号和名称
            let partSuggestions: [PartSuggestion] = parts?.compactMap { part in
                if let number = part.value(forKey: "part_num") as? String, !number.isEmpty {
                    let name = part.value(forKey: "name") as? String ?? ""
                    return PartSuggestion(number: number, name: name)
                }
                return nil
            } ?? []
            
            print("提取零件型号和名称，数量: \(partSuggestions.count)")
            
            // 去重，避免重复型号
            var uniqueParts: [PartSuggestion] = []
            var seenNumbers: Set<String> = []
            
            for part in partSuggestions {
                if !seenNumbers.contains(part.number) {
                    seenNumbers.insert(part.number)
                    uniqueParts.append(part)
                }
            }
            
            // 如果没有零件数据，使用模拟数据作为fallback
            if uniqueParts.isEmpty {
                print("数据库中没有零件数据，使用模拟数据")
                uniqueParts = [
                    PartSuggestion(number: "3001", name: "2x4 Brick"),
                    PartSuggestion(number: "3002", name: "2x3 Brick"),
                    PartSuggestion(number: "3003", name: "2x2 Brick"),
                    PartSuggestion(number: "3004", name: "1x2 Brick"),
                    PartSuggestion(number: "3005", name: "1x1 Brick"),
                    PartSuggestion(number: "3010", name: "1x4 Brick"),
                    PartSuggestion(number: "3011", name: "1x6 Brick"),
                    PartSuggestion(number: "3020", name: "2x2 Plate"),
                    PartSuggestion(number: "3021", name: "2x3 Plate"),
                    PartSuggestion(number: "3022", name: "2x4 Plate"),
                    PartSuggestion(number: "3023", name: "1x2 Plate"),
                    PartSuggestion(number: "3024", name: "1x3 Plate"),
                    PartSuggestion(number: "3031", name: "1x1 Plate"),
                    PartSuggestion(number: "3032", name: "1x4 Plate"),
                    PartSuggestion(number: "3033", name: "1x6 Plate"),
                    PartSuggestion(number: "3034", name: "2x6 Plate"),
                    PartSuggestion(number: "3035", name: "2x8 Plate"),
                    PartSuggestion(number: "3040", name: "1x2 Tile"),
                    PartSuggestion(number: "3041", name: "1x3 Tile"),
                    PartSuggestion(number: "3042", name: "1x4 Tile")
                ]
            }
            
            print("去重后零件数据，数量: \(uniqueParts.count)")
            
            // 更新缓存
            cachedParts[dataSource] = uniqueParts
            cacheTimestamps[dataSource] = Date()
            
            return uniqueParts
        }
    }
    
    // 清除缓存
    static func clearCache() {
        cacheQueue.sync {
            cachedParts = [:]
            cacheTimestamps = [:]
        }
    }
    
    // 清除特定数据源的缓存
    static func clearCache(dataSource: PartNumberSuggestionManager.DataSource) {
        cacheQueue.sync {
            cachedParts.removeValue(forKey: dataSource)
            cacheTimestamps.removeValue(forKey: dataSource)
        }
    }
    
    // 获取零件型号联想列表
    // - Parameter searchText: 用户输入的搜索文本
    // - Parameter dataSource: 数据源类型
    // - Returns: 匹配的零件型号和名称列表
    static func getSuggestions(for searchText: String, dataSource: PartNumberSuggestionManager.DataSource) -> [PartSuggestion] {
        // 快速返回空结果的情况
        if searchText.isEmpty {
            return []
        }
        
        // 无论搜索文本长度如何，都使用数据库查询过滤，减少内存使用
        let suggestions = getSuggestionsFromDatabase(for: searchText, dataSource: dataSource)
        
        // 限制返回结果数量，避免内存问题
        // 即使没有数据库级别的限制，也在应用层面限制结果数量
        let maxResults = 50 // 最多返回50条结果
        return Array(suggestions.prefix(maxResults))
    }
    
    // 从数据库直接获取匹配的零件型号联想列表
    private static func getSuggestionsFromDatabase(for searchText: String, dataSource: PartNumberSuggestionManager.DataSource) -> [PartSuggestion] {
        print("从数据库直接获取联想结果，搜索文本: \(searchText)")
        
        // 限制搜索文本长度，避免过长的搜索
        let trimmedSearchText = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedSearchText.count > 10 {
            print("搜索文本过长，返回空结果")
            return []
        }
        
        // 根据数据源选择不同的实体和上下文
        let entityName: String
        let parentContext: NSManagedObjectContext
        let persistence = PersistenceController.shared
        
        switch dataSource {
        case .system:
            entityName = "Part"
            parentContext = persistence.container.viewContext
        case .rb:
            entityName = "Parts"
            parentContext = persistence.rbContainer.viewContext
        }
        
        // 创建私有上下文用于后台线程
        let privateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
        privateContext.parent = parentContext
        
        // 创建查询请求
        let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: entityName)
        
        // 只获取part_num和name属性，提高性能
        fetchRequest.propertiesToFetch = ["part_num", "name"]
        
        // 添加前缀匹配谓词
        fetchRequest.predicate = NSPredicate(format: "part_num BEGINSWITH[cd] %@", trimmedSearchText)
        
        // 按型号排序
        fetchRequest.sortDescriptors = [NSSortDescriptor(key: "part_num", ascending: true)]
        
        // 限制批量获取大小，提高性能
        fetchRequest.fetchBatchSize = 50
        
        // 执行查询
        var partSuggestions: [PartSuggestion] = []
        
        // 在私有上下文的队列中执行查询
        privateContext.performAndWait { 
            do {
                let parts = try privateContext.fetch(fetchRequest)
                print("数据库查询成功，获取到 \(parts.count) 条结果")
                
                // 提取零件型号和名称
                partSuggestions = parts.compactMap { part in
                    if let number = part.value(forKey: "part_num") as? String, !number.isEmpty {
                        let name = part.value(forKey: "name") as? String ?? ""
                        return PartSuggestion(number: number, name: name)
                    }
                    return nil
                }
            } catch {
                print("数据库查询失败: \(error)")
            }
        }
        
        return partSuggestions
    }
    
    // 异步获取零件型号联想列表
    // - Parameter searchText: 用户输入的搜索文本
    // - Parameter dataSource: 数据源类型
    // - Parameter completion: 完成回调，返回匹配的零件型号和名称列表
    static func getSuggestionsAsync(for searchText: String, dataSource: PartNumberSuggestionManager.DataSource, completion: @escaping ([PartSuggestion]) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            let suggestions = getSuggestions(for: searchText, dataSource: dataSource)
            DispatchQueue.main.async {
                completion(suggestions)
            }
        }
    }
}

// 零件型号联想视图
struct PartNumberSuggestionPopupView: View {
    @Binding var partNumberInput: String
    @Binding var showSuggestions: Bool
    @Binding var suggestions: [PartSuggestion]
    @Binding var inputBoxFrame: CGRect
    var dataSource: PartNumberSuggestionManager.DataSource = .rb // 默认从RB数据库获取数据
    var onPartNumberChange: ((String) -> Void)? = nil
    
    // 定时器变量
    @State private var suggestionTimer: Timer? = nil
    // 选择状态定时器
    @State private var selectionTimer: Timer? = nil
    // 用于跟踪视图是否仍然存在
    @State private var isViewAlive = true
    // 用于跟踪是否是用户手动输入
    @State private var isUserInput = false
    
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            // 添加标题，与其他输入框保持一致
            Text("型号")
                .font(.system(size: 14, weight: .medium))
            
            // 输入框
            TextField("请输入零件型号", text: $partNumberInput)
                .font(.system(size: 14))
                .padding(6)
                .border(Color.gray.opacity(0.3))
                .cornerRadius(4)
                .frame(width: 200) // 设置宽度为200点
                .frame(height: 32) // 统一输入框高度
                .background(
                    GeometryReader { geometry in
                        Color.clear
                            .onAppear {
                                // 获取输入框相对于全局的坐标
                                inputBoxFrame = geometry.frame(in: .global)
                                print("输入框全局坐标: \(inputBoxFrame)")
                            }
                            .onChange(of: geometry.frame(in: .global)) { oldValue, newValue in
                                inputBoxFrame = newValue
                                print("输入框全局坐标已更新: \(inputBoxFrame)")
                            }
                    }
                )
                .onChange(of: partNumberInput) { oldValue, newValue in
                    print("输入框内容已更改: \(newValue)")
                    // 清除之前的定时器
                    suggestionTimer?.invalidate()
                    selectionTimer?.invalidate()
                    
                    // 输入为空时清除建议
                    if newValue.isEmpty {
                        print("输入为空，清除建议")
                        self.suggestions = []
                        self.showSuggestions = false
                        // 触发回调
                        onPartNumberChange?(newValue)
                    } else if isUserInput { // 只有当用户手动输入时才触发联想
                        // 限制搜索文本长度，避免过长的搜索
                        let trimmedInput = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
                        if trimmedInput.count > 10 {
                            print("搜索文本过长，不触发查询")
                            self.suggestions = []
                            self.showSuggestions = false
                            // 触发回调
                            onPartNumberChange?(newValue)
                            return
                        }
                        
                        // 设置新的定时器，延迟1.5秒后触发查询，进一步减少频繁查询
                        suggestionTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: false) { _ in
                            // 检查视图是否仍然存在
                            guard isViewAlive else { return }
                            
                            // 检查输入是否已被修改
                            let currentInput = self.partNumberInput
                            print("定时器触发，当前输入: \(currentInput)")
                            
                            if !currentInput.isEmpty && self.isUserInput {
                                // 再次检查搜索文本长度
                                let currentTrimmedInput = currentInput.trimmingCharacters(in: .whitespacesAndNewlines)
                                if currentTrimmedInput.count > 10 {
                                    print("搜索文本过长，不触发查询")
                                    return
                                }
                                
                                // 使用实际的数据库数据获取联想结果
                                print("开始从\(dataSource == .system ? "系统数据库" : "RB数据库")获取联想结果...")
                                // 先显示加载状态
                                DispatchQueue.main.async {
                                    // 再次检查视图是否仍然存在
                                    guard self.isViewAlive else { return }
                                    self.showSuggestions = true
                                    // 可以在这里添加一个加载指示器
                                }
                                PartNumberSuggestionManager.getSuggestionsAsync(for: currentInput, dataSource: dataSource) { fetchedSuggestions in
                                    // 再次检查视图是否仍然存在
                                    guard self.isViewAlive else { return }
                                    
                                    print("获取到联想结果，数量: \(fetchedSuggestions.count)")
                                    DispatchQueue.main.async {
                                        // 再次检查视图是否仍然存在
                                        guard self.isViewAlive else { return }
                                        
                                        // 确保输入没有变化且仍然是用户输入状态
                                        if self.partNumberInput == currentInput && self.isUserInput {
                                            print("更新联想建议到UI")
                                            self.suggestions = fetchedSuggestions
                                            self.showSuggestions = !fetchedSuggestions.isEmpty
                                            print("联想建议已更新，显示状态: \(self.showSuggestions)")
                                            
                                            // 启动选择状态定时器，10秒后自动退出
                                            if self.showSuggestions {
                                                self.selectionTimer?.invalidate()
                                                self.selectionTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: false) { _ in
                                                    guard self.isViewAlive else { return }
                                                    print("选择状态10秒无变化，自动退出联想器")
                                                    self.showSuggestions = false
                                                    self.suggestions = []
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        // 触发回调
                        onPartNumberChange?(newValue)
                    } else {
                        // 非用户输入，不触发联想，但仍然触发回调
                        onPartNumberChange?(newValue)
                    }
                }
                .onTapGesture {
                    print("输入框被点击，当前内容: \(partNumberInput)")
                    // 设置为用户输入状态
                    self.isUserInput = true
                    print("设置为用户输入状态")
                    
                    // 点击输入框时，如果有输入内容，显示联想建议
                    if !partNumberInput.isEmpty {
                        // 限制搜索文本长度，避免过长的搜索
                        let trimmedInput = partNumberInput.trimmingCharacters(in: .whitespacesAndNewlines)
                        if trimmedInput.count > 10 {
                            print("搜索文本过长，不显示联想建议")
                            return
                        }
                        
                        // 使用实际的数据库数据获取联想结果
                        print("开始从\(dataSource == .system ? "系统数据库" : "RB数据库")获取点击时的联想结果...")
                        let currentInput = partNumberInput
                        PartNumberSuggestionManager.getSuggestionsAsync(for: currentInput, dataSource: dataSource) { fetchedSuggestions in
                            // 检查视图是否仍然存在
                            guard self.isViewAlive else { return }
                            
                            print("获取到点击时的联想结果，数量: \(fetchedSuggestions.count)")
                            DispatchQueue.main.async {
                                // 再次检查视图是否仍然存在
                                guard self.isViewAlive else { return }
                                
                                // 限制显示的建议数量
                                let limitedSuggestions = Array(fetchedSuggestions.prefix(20))
                                self.suggestions = limitedSuggestions
                                self.showSuggestions = !limitedSuggestions.isEmpty
                                print("点击时的联想建议已更新，显示状态: \(self.showSuggestions)")
                                
                                // 启动选择状态定时器，10秒后自动退出
                                if self.showSuggestions {
                                    self.selectionTimer?.invalidate()
                                    self.selectionTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: false) { _ in
                                        guard self.isViewAlive else { return }
                                        print("选择状态10秒无变化，自动退出联想器")
                                        self.showSuggestions = false
                                        self.suggestions = []
                                    }
                                }
                            }
                        }
                    }
                }
                .onSubmit {
                    print("用户提交输入，退出联想器")
                    self.showSuggestions = false
                    self.suggestions = []
                    selectionTimer?.invalidate()
                }
        }
        .padding(.horizontal, 15) // 与其他输入框保持一致的水平边距
        .contentShape(Rectangle()) // 确保整个区域都能响应点击
        .onTapGesture {
            // 点击输入框外部时，不做任何操作
        }
        .simultaneousGesture(
            TapGesture()
                .onEnded { _ in
                    // 点击整个区域时的处理
                }
        )
        .onAppear {
            isViewAlive = true
        }
        .onDisappear {
            isViewAlive = false
            // 清除定时器
            suggestionTimer?.invalidate()
            selectionTimer?.invalidate()
        }
    }
}



// 视图状态枚举
enum ViewState: Equatable {
    case main
    case repositoryManagement
    case boxManagement(NSManagedObject)
    case partManagement(NSManagedObject)
    case addPart(NSManagedObject)
    case partDetail(NSManagedObject)
    case search
    case searchWithPartNumber(String) // 带零件型号的搜索状态
    case settings
    case colorManagement
    
    static func == (lhs: ViewState, rhs: ViewState) -> Bool {
        switch (lhs, rhs) {
        case (.main, .main):
            return true
        case (.repositoryManagement, .repositoryManagement):
            return true
        case (.boxManagement(let lhsObj), .boxManagement(let rhsObj)):
            return lhsObj.objectID == rhsObj.objectID
        case (.partManagement(let lhsObj), .partManagement(let rhsObj)):
            return lhsObj.objectID == rhsObj.objectID
        case (.addPart(let lhsObj), .addPart(let rhsObj)):
            return lhsObj.objectID == rhsObj.objectID
        case (.partDetail(let lhsObj), .partDetail(let rhsObj)):
            return lhsObj.objectID == rhsObj.objectID
        case (.search, .search):
            return true
        case (.searchWithPartNumber(let lhsNum), .searchWithPartNumber(let rhsNum)):
            return lhsNum == rhsNum
        case (.settings, .settings):
            return true
        case (.colorManagement, .colorManagement):
            return true
        default:
            return false
        }
    }
}

// 持久化控制器
struct PersistenceController {
    static let shared = PersistenceController()

    @MainActor
    static let preview: PersistenceController = {
        let result = PersistenceController(inMemory: true)
        let viewContext = result.container.viewContext
        
        // 创建示例仓库
        let repository1 = NSEntityDescription.insertNewObject(forEntityName: "Repository", into: viewContext)
        repository1.setValue("仓库1", forKey: "name")
        
        let repository2 = NSEntityDescription.insertNewObject(forEntityName: "Repository", into: viewContext)
        repository2.setValue("仓库2", forKey: "name")
        
        // 为仓库1创建示例盒子
        let box1 = NSEntityDescription.insertNewObject(forEntityName: "Box", into: viewContext)
        box1.setValue("盒子1", forKey: "name")
        box1.setValue(Int32(1), forKey: "boxNumber")
        box1.setValue(repository1, forKey: "repository")
        
        let box2 = NSEntityDescription.insertNewObject(forEntityName: "Box", into: viewContext)
        box2.setValue("盒子2", forKey: "name")
        box2.setValue(Int32(2), forKey: "boxNumber")
        box2.setValue(repository1, forKey: "repository")
        
        // 为仓库2创建示例盒子
        let box3 = NSEntityDescription.insertNewObject(forEntityName: "Box", into: viewContext)
        box3.setValue("盒子3", forKey: "name")
        box3.setValue(Int32(1), forKey: "boxNumber")
        box3.setValue(repository2, forKey: "repository")
        
        // 为盒子1创建示例零件
        let part1 = NSEntityDescription.insertNewObject(forEntityName: "Part", into: viewContext)
        part1.setValue("零件1", forKey: "name")
        part1.setValue("MODEL001", forKey: "part_num")
        part1.setValue(Int32(1), forKey: "color_id")
        part1.setValue(false, forKey: "is_new")
        part1.setValue(Int32(5), forKey: "quantity")
        part1.setValue(box1, forKey: "box")
        
        let part2 = NSEntityDescription.insertNewObject(forEntityName: "Part", into: viewContext)
        part2.setValue("零件2", forKey: "name")
        part2.setValue("MODEL002", forKey: "part_num")
        part2.setValue(Int32(2), forKey: "color_id")
        part2.setValue(true, forKey: "is_new")
        part2.setValue(Int32(3), forKey: "quantity")
        part2.setValue(box1, forKey: "box")
        
        // 为盒子2创建示例零件
        let part3 = NSEntityDescription.insertNewObject(forEntityName: "Part", into: viewContext)
        part3.setValue("零件3", forKey: "name")
        part3.setValue("MODEL003", forKey: "part_num")
        part3.setValue(Int32(3), forKey: "color_id")
        part3.setValue(false, forKey: "is_new")
        part3.setValue(Int32(2), forKey: "quantity")
        part3.setValue(box2, forKey: "box")
        
        do {
            try viewContext.save()
        } catch {
            // Replace this implementation with code to handle the error appropriately.
            // fatalError() causes the application to generate a crash log and terminate. You should not use this function in a shipping application, although it may be useful during development.
            let nsError = error as NSError
            fatalError("Unresolved error \(nsError), \(nsError.userInfo)")
        }
        return result
    }()

    let container: NSPersistentContainer
    let rbContainer: NSPersistentContainer

    init(inMemory: Bool = false) {
        // 主数据库容器
        container = NSPersistentContainer(name: "SYS_PARTS")
        
        // 添加自动迁移选项
        let description = container.persistentStoreDescriptions.first
        description?.shouldMigrateStoreAutomatically = true
        description?.shouldInferMappingModelAutomatically = true
        
        if inMemory {
            container.persistentStoreDescriptions.first!.url = URL(fileURLWithPath: "/dev/null")
        } else {
            // 明确设置系统数据库的路径，确保使用正确的文件
            let documentsDirectory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
            if let documentsDirectory = documentsDirectory {
                let storeURL = documentsDirectory.appendingPathComponent("SYS_PARTS.sqlite")
                container.persistentStoreDescriptions.first?.url = storeURL
                print("系统数据库路径已设置为: \(storeURL.path)")
            }
        }
        // 保存对container的引用到局部变量，避免在闭包中捕获self
        let containerRef = container
        
        containerRef.loadPersistentStores(completionHandler: { (storeDescription, error) in
            if let error = error as NSError? {
                // 检查是否是数据库损坏错误或迁移错误
                if error.domain == NSCocoaErrorDomain && (error.code == 259 || error.code == 134110) {
                    print("数据库文件损坏或迁移失败，尝试自动修复...")
                    
                    // 尝试删除损坏的数据库文件
                    if let storeURL = containerRef.persistentStoreDescriptions.first?.url {
                        let storeFiles = [
                            storeURL,
                            storeURL.appendingPathExtension("shm"),
                            storeURL.appendingPathExtension("wal")
                        ]
                        
                        let fileManager = FileManager.default
                        for fileURL in storeFiles {
                            if fileManager.fileExists(atPath: fileURL.path) {
                                do {
                                    try fileManager.removeItem(at: fileURL)
                                    print("已删除损坏的文件: \(fileURL.lastPathComponent)")
                                } catch {
                                    print("删除文件失败: \(error)")
                                }
                            }
                        }
                        
                        // 重新加载持久化存储
                        do {
                            try containerRef.persistentStoreCoordinator.destroyPersistentStore(at: storeURL, ofType: NSSQLiteStoreType, options: nil)
                            try containerRef.persistentStoreCoordinator.addPersistentStore(ofType: NSSQLiteStoreType, configurationName: nil, at: storeURL, options: nil)
                            print("成功重新创建数据库存储")
                        } catch {
                            fatalError("无法重新创建数据库存储: \(error)")
                        }
                    }
                } else {
                    fatalError("Unresolved error \(error), \(error.userInfo)")
                }
            }
        })
        container.viewContext.automaticallyMergesChangesFromParent = true
        
        // RB数据库容器
        rbContainer = NSPersistentContainer(name: "RB")
        
        // 为RB数据库设置不同的存储URL
        let rbDescription = rbContainer.persistentStoreDescriptions.first
        rbDescription?.shouldMigrateStoreAutomatically = true
        rbDescription?.shouldInferMappingModelAutomatically = true
        
        if inMemory {
            if let firstDescription = rbContainer.persistentStoreDescriptions.first {
                firstDescription.url = URL(fileURLWithPath: "/dev/null")
            }
        } else {
            // 使用不同的文件名存储RB数据库
            if let containerFirstDescription = container.persistentStoreDescriptions.first,
               let containerURL = containerFirstDescription.url,
               let rbFirstDescription = rbContainer.persistentStoreDescriptions.first {
                let storeURL = containerURL.deletingLastPathComponent().appendingPathComponent("RB.sqlite")
                rbFirstDescription.url = storeURL
            }
        }
        
        // 保存对rbContainer的引用到局部变量，避免在闭包中捕获self
        let rbContainerRef = rbContainer
        
        rbContainerRef.loadPersistentStores(completionHandler: { (storeDescription, error) in
            if let error = error as NSError? {
                // 检查是否是迁移错误
                if error.domain == NSCocoaErrorDomain && error.code == 134140 {
                    print("RB数据库迁移失败，尝试删除旧存储文件并重新创建")
                    
                    // 尝试删除旧的存储文件
                    if let storeURL = rbContainerRef.persistentStoreDescriptions.first?.url {
                        let storeFiles = [
                            storeURL,
                            storeURL.appendingPathExtension("shm"),
                            storeURL.appendingPathExtension("wal")
                        ]
                        
                        for fileURL in storeFiles {
                            do {
                                if FileManager.default.fileExists(atPath: fileURL.path) {
                                    try FileManager.default.removeItem(at: fileURL)
                                    print("删除旧存储文件: \(fileURL.lastPathComponent)")
                                }
                            } catch {
                                print("删除文件失败: \(error)")
                            }
                        }
                        
                        // 重新加载持久化存储
                        do {
                            try rbContainerRef.persistentStoreCoordinator.destroyPersistentStore(at: storeURL, ofType: NSSQLiteStoreType, options: nil)
                            try rbContainerRef.persistentStoreCoordinator.addPersistentStore(ofType: NSSQLiteStoreType, configurationName: nil, at: storeURL, options: nil)
                            print("成功重新创建RB数据库存储")
                        } catch {
                            fatalError("无法重新创建RB数据库存储: \(error)")
                        }
                    } else {
                        fatalError("无法获取RB数据库存储URL")
                    }
                } else {
                    fatalError("Unresolved error \(error), \(error.userInfo)")
                }
            }
        })
        rbContainer.viewContext.automaticallyMergesChangesFromParent = true
    }
    
    // 获取主数据库文件路径
    func getMainDatabaseURL() -> URL? {
        // 从persistentStoreCoordinator中获取实际的存储URL
        for store in container.persistentStoreCoordinator.persistentStores {
            if let url = store.url {
                return url
            }
        }
        // 如果没有找到，返回配置的URL
        return container.persistentStoreDescriptions.first?.url
    }
    
    // 获取RB数据库文件路径
    func getRBDatabaseURL() -> URL? {
        // 从persistentStoreCoordinator中获取实际的存储URL
        for store in rbContainer.persistentStoreCoordinator.persistentStores {
            if let url = store.url {
                return url
            }
        }
        // 如果没有找到，返回配置的URL
        return rbContainer.persistentStoreDescriptions.first?.url
    }
    
    // 备份数据库到指定URL
    func backupDatabase(to backupURL: URL, isRB: Bool) throws {
        // 首先保存上下文，确保所有更改都已写入磁盘
        if isRB {
            if rbContainer.viewContext.hasChanges {
                try rbContainer.viewContext.save()
                print("已保存RB数据库上下文")
            }
            // 重置上下文以确保所有更改都已持久化
            rbContainer.viewContext.reset()
            print("已重置RB数据库上下文")
        } else {
            if container.viewContext.hasChanges {
                try container.viewContext.save()
                print("已保存系统数据库上下文")
            }
            // 重置上下文以确保所有更改都已持久化
            container.viewContext.reset()
            print("已重置系统数据库上下文")
        }
        
        // 强制Core Data将WAL文件中的数据合并到主数据库文件
        if isRB {
            for store in rbContainer.persistentStoreCoordinator.persistentStores {
                if let storeURL = store.url {
                    rbContainer.persistentStoreCoordinator.setURL(storeURL, for: store)
                    print("已强制合并RB数据库的WAL文件")
                }
            }
        } else {
            for store in container.persistentStoreCoordinator.persistentStores {
                if let storeURL = store.url {
                    container.persistentStoreCoordinator.setURL(storeURL, for: store)
                    print("已强制合并系统数据库的WAL文件")
                }
            }
        }
        
        let sourceURL = isRB ? getRBDatabaseURL() : getMainDatabaseURL()
        guard let sourceURL = sourceURL else {
            throw NSError(domain: "PersistenceError", code: 1, userInfo: [NSLocalizedDescriptionKey: "无法获取数据库文件路径"])
        }
        
        // 打印详细的数据库路径信息
        print("备份类型: \(isRB ? "RB数据库" : "系统数据库")")
        print("源数据库路径: \(sourceURL.path)")
        print("备份目标路径: \(backupURL.path)")
        
        // 检查源文件是否存在及其大小
        let fileManager = FileManager.default
        // 安全检查路径是否有效
        guard !sourceURL.path.isEmpty else {
            print("警告: 源数据库文件路径为空")
            return
        }
        
        if fileManager.fileExists(atPath: sourceURL.path) {
            do {
                let attributes = try fileManager.attributesOfItem(atPath: sourceURL.path)
                if let fileSize = attributes[.size] as? Int64 {
                    print("源数据库文件大小: \(fileSize) 字节")
                }
                if let modificationDate = attributes[.modificationDate] as? Date {
                    print("源数据库文件修改时间: \(modificationDate)")
                }
            } catch {
                print("获取文件属性失败: \(error)")
            }
        } else {
            print("警告: 源数据库文件不存在: \(sourceURL.path)")
        }
        
        // 确保备份目录存在
        let backupDir = backupURL.deletingLastPathComponent()
        do {
            if !fileManager.fileExists(atPath: backupDir.path) {
                try fileManager.createDirectory(at: backupDir, withIntermediateDirectories: true)
                print("已创建备份目录: \(backupDir.path)")
            }
        } catch {
            print("创建备份目录失败: \(error)")
            throw error
        }
        
        // 复制数据库文件及其相关文件
        do {
            // 复制主数据库文件
            try fileManager.copyItem(at: sourceURL, to: backupURL)
            print("已复制主数据库文件: \(sourceURL.lastPathComponent) 到 \(backupURL.lastPathComponent)")
            
            // 复制相关文件（.shm和.wal）
            let shmURL = sourceURL.appendingPathExtension("shm")
            let walURL = sourceURL.appendingPathExtension("wal")
            
            if fileManager.fileExists(atPath: shmURL.path) {
                let backupShmURL = backupURL.appendingPathExtension("shm")
                try fileManager.copyItem(at: shmURL, to: backupShmURL)
                print("已复制SHM文件: \(shmURL.lastPathComponent)")
            } else {
                print("SHM文件不存在: \(shmURL.path)")
            }
            
            if fileManager.fileExists(atPath: walURL.path) {
                let backupWalURL = backupURL.appendingPathExtension("wal")
                try fileManager.copyItem(at: walURL, to: backupWalURL)
                print("已复制WAL文件: \(walURL.lastPathComponent)")
            } else {
                print("WAL文件不存在: \(walURL.path)")
            }
        } catch {
            print("复制数据库文件失败: \(error)")
            throw error
        }
        
        // 验证备份文件是否创建成功
        // 安全检查路径是否有效
        guard !backupURL.path.isEmpty else {
            print("警告: 备份文件路径为空")
            return
        }
        
        if fileManager.fileExists(atPath: backupURL.path) {
            do {
                let attributes = try fileManager.attributesOfItem(atPath: backupURL.path)
                if let fileSize = attributes[.size] as? Int64 {
                    print("备份文件大小: \(fileSize) 字节")
                }
                if let creationDate = attributes[.creationDate] as? Date {
                    print("备份文件创建时间: \(creationDate)")
                }
            } catch {
                print("获取备份文件属性失败: \(error)")
            }
        } else {
            print("警告: 备份文件创建失败: \(backupURL.path)")
        }
    }
    
    // 从指定URL恢复数据库
    func restoreDatabase(from backupURL: URL, isRB: Bool) throws {
        let targetContainer = isRB ? rbContainer : container
        guard let targetURL = (isRB ? getRBDatabaseURL() : getMainDatabaseURL()) else {
            throw NSError(domain: "PersistenceError", code: 1, userInfo: [NSLocalizedDescriptionKey: "无法获取数据库文件路径"])
        }
        
        // 关闭持久化存储
        for store in targetContainer.persistentStoreCoordinator.persistentStores {
            try targetContainer.persistentStoreCoordinator.remove(store)
        }
        print("已关闭持久化存储")
        
        // 删除现有数据库文件
        let fileManager = FileManager.default
        let filesToDelete = [
            targetURL,
            targetURL.appendingPathExtension("shm"),
            targetURL.appendingPathExtension("wal")
        ]
        
        for fileURL in filesToDelete {
            if fileManager.fileExists(atPath: fileURL.path) {
                try fileManager.removeItem(at: fileURL)
                print("已删除现有文件: \(fileURL.lastPathComponent)")
            }
        }
        
        // 复制备份文件到目标位置
        try fileManager.copyItem(at: backupURL, to: targetURL)
        print("已复制备份文件: \(backupURL.lastPathComponent) 到 \(targetURL.lastPathComponent)")
        
        // 复制相关文件
        let backupShmURL = backupURL.appendingPathExtension("shm")
        let backupWalURL = backupURL.appendingPathExtension("wal")
        
        if fileManager.fileExists(atPath: backupShmURL.path) {
            let targetShmURL = targetURL.appendingPathExtension("shm")
            try fileManager.copyItem(at: backupShmURL, to: targetShmURL)
            print("已复制SHM备份文件")
        }
        
        if fileManager.fileExists(atPath: backupWalURL.path) {
            let targetWalURL = targetURL.appendingPathExtension("wal")
            try fileManager.copyItem(at: backupWalURL, to: targetWalURL)
            print("已复制WAL备份文件")
        }
        
        // 重新加载持久化存储
        let description = NSPersistentStoreDescription(url: targetURL)
        description.shouldMigrateStoreAutomatically = true
        description.shouldInferMappingModelAutomatically = true
        targetContainer.persistentStoreDescriptions = [description]
        
        targetContainer.loadPersistentStores(completionHandler: { (storeDescription, error) in
            if let error = error as NSError? {
                fatalError("Unresolved error \(error), \(error.userInfo)")
            }
        })
        
        print("数据库恢复成功")
    }
}
