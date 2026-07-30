import Foundation
import CoreData

// 零件名称联想功能
enum PartNameSuggestion {
    // 缓存变量，用于存储零件名称列表，避免重复数据库查询
    private static var cachedPartNames: [String: [String]] = [:] // key: tableName, value: part names
    
    // 缓存有效期（秒）
    private static let cacheExpiryInterval: TimeInterval = 3600 // 1小时
    
    // 缓存时间戳
    private static var cacheTimestamps: [String: Date] = [:] // key: tableName, value: timestamp
    
    // 数据库表类型
    enum TableType {
        case parts // RB数据库的parts表
        case part  // Parts数据库的part表
        
        var entityName: String {
            switch self {
            case .parts:
                return "Parts" // RB数据库的parts表实体名
            case .part:
                return "Part"  // Parts数据库的part表实体名
            }
        }
        
        var containerName: String {
            switch self {
            case .parts:
                return "rb"
            case .part:
                return "container"
            }
        }
    }
    
    // 获取所有零件名称（带缓存）
    private static func getAllPartNames(tableType: TableType) -> [String] {
        let cacheKey = tableType.entityName
        
        // 检查缓存是否有效
        if let cachedNames = cachedPartNames[cacheKey], 
           let timestamp = cacheTimestamps[cacheKey], 
           Date().timeIntervalSince(timestamp) < cacheExpiryInterval {
            return cachedNames
        }
        
        // 创建查询请求
        let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: tableType.entityName)
        
        // 只获取name属性，提高性能
        fetchRequest.propertiesToFetch = ["name"]
        
        // 限制批量获取大小，提高性能
        fetchRequest.fetchBatchSize = 100
        
        // 执行查询
        let persistence = PersistenceController.shared
        var names: [String] = []
        
        switch tableType {
        case .parts:
            // 使用后台上下文执行查询
            let backgroundContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
            backgroundContext.parent = persistence.rbContainer.viewContext
            
            backgroundContext.performAndWait { 
                if let parts = try? backgroundContext.fetch(fetchRequest) {
                    names = parts.compactMap { part in
                        return part.value(forKey: "name") as? String
                    }
                }
            }
        case .part:
            // 使用后台上下文执行查询
            let backgroundContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
            backgroundContext.parent = persistence.container.viewContext
            
            backgroundContext.performAndWait { 
                if let parts = try? backgroundContext.fetch(fetchRequest) {
                    names = parts.compactMap { part in
                        return part.value(forKey: "name") as? String
                    }
                }
            }
        }
        
        // 更新缓存
        cachedPartNames[cacheKey] = names
        cacheTimestamps[cacheKey] = Date()
        
        return names
    }
    
    // 清除缓存
    static func clearCache() {
        cachedPartNames = [:]
        cacheTimestamps = [:]
    }
    
    // 清除特定表的缓存
    static func clearCache(tableType: TableType) {
        let cacheKey = tableType.entityName
        cachedPartNames.removeValue(forKey: cacheKey)
        cacheTimestamps.removeValue(forKey: cacheKey)
    }
    
    // 智能分词函数，处理特殊格式如"1 x 2"和连续数字
    private static func smartTokenize(_ text: String) -> [String] {
        // 快速路径：如果文本不包含"x"且不包含数字，直接按空格分词
        guard text.contains("x") || text.contains("X") || text.contains(where: { $0.isNumber }) else {
            let tokens = text.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
            return processTokens(tokens)
        }
        
        // 限制文本长度，防止过长文本导致性能问题
        let maxTextLength = 100
        let safeText = text.count > maxTextLength ? String(text.prefix(maxTextLength)) : text
        
        // 否则执行智能分词
        let tokens = safeText.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
        var result: [String] = []
        
        // 限制分词数量，防止过多分词导致性能问题
        let maxTokens = 20
        let safeTokens = Array(tokens.prefix(maxTokens))
        
        var i = 0
        while i < safeTokens.count {
            let token = safeTokens[i]
            
            // 检查是否是数字，并且后面跟着"x"和另一个数字
            if i + 2 < safeTokens.count, 
               let _ = Int(token), 
               safeTokens[i+1].lowercased() == "x", 
               let _ = Int(safeTokens[i+2]) {
                // 将"数字 x 数字"视为一个单词
                let combinedToken = "\(token) \(safeTokens[i+1]) \(safeTokens[i+2])"
                result.append(combinedToken)
                i += 3
            } else {
                // 检查是否是数字
                if let _ = Int(token) {
                    // 将连续的数字视为一个整体
                    var numberTokens = [token]
                    var j = i + 1
                    
                    // 检查后续是否也是数字
                    while j < safeTokens.count, let _ = Int(safeTokens[j]) {
                        numberTokens.append(safeTokens[j])
                        j += 1
                    }
                    
                    if numberTokens.count > 1 {
                        // 如果有多个连续数字，将它们合并为一个单词
                        result.append(numberTokens.joined(separator: " "))
                        i = j
                    } else {
                        // 单个数字，作为普通单词
                        result.append(token)
                        i += 1
                    }
                } else {
                    // 普通单词
                    result.append(token)
                    i += 1
                }
            }
        }
        
        // 处理分词结果，前4个分词独立显示，后面的所有词联合成一个
        return processTokens(result)
    }
    
    // 处理分词结果，前4个分词独立显示，后面的所有词联合成一个
    private static func processTokens(_ tokens: [String]) -> [String] {
        var result: [String] = []
        
        // 前4个分词以独立单词显示
        let firstFourTokens = Array(tokens.prefix(4))
        result.append(contentsOf: firstFourTokens)
        
        // 后面的所有词联合成一个
        if tokens.count > 4 {
            let remainingTokens = Array(tokens.suffix(tokens.count - 4))
            let combinedToken = remainingTokens.joined(separator: " ")
            result.append(combinedToken)
        }
        
        return result
    }
    
    // 获取零件名称联想列表（基于单词分词）
    // - Parameter searchText: 用户输入的搜索文本
    // - Parameter wordIndex: 当前正在输入的单词索引（从0开始）
    // - Parameter previousWords: 之前输入的单词，用于上下文过滤
    // - Parameter tableType: 数据库表类型，默认为Part表
    // - Returns: 匹配的单词列表
    static func getSuggestions(for searchText: String, wordIndex: Int = 0, previousWords: [String] = [], tableType: TableType = .part) -> [String] {
        // 限制搜索文本长度，避免过长文本导致性能问题
        let maxSearchTextLength = 50
        let safeSearchText = searchText.count > maxSearchTextLength ? String(searchText.prefix(maxSearchTextLength)) : searchText
        
        // 获取所有零件名称（使用缓存）
        let allPartNames = getAllPartNames(tableType: tableType)
        
        // 如果没有零件名称，返回空数组
        guard !allPartNames.isEmpty else {
            return []
        }
        
        // 提取零件名称并处理单词分词
        var uniqueWords = Set<String>()
        
        // 取消处理的零件名称数量限制，使用流式处理避免内存问题
        // 直接处理所有零件名称，但使用高效的处理方式
        for name in allPartNames {
            guard !name.isEmpty else { continue }
            
            // 使用智能分词
            let words = smartTokenize(name)
            
            // 检查是否匹配之前输入的所有单词
            var matchesPreviousWords = true
            for (index, prevWord) in previousWords.enumerated() {
                if index >= words.count {
                    matchesPreviousWords = false
                    break
                }
                let nameWord = words[index]
                if !nameWord.lowercased().hasPrefix(prevWord.lowercased()) {
                    matchesPreviousWords = false
                    break
                }
            }
            
            if !matchesPreviousWords {
                continue
            }
            
            // 确保单词索引有效
            if wordIndex < words.count {
                let targetWord = words[wordIndex]
                
                // 检查单词是否以前缀匹配搜索文本
                if targetWord.lowercased().hasPrefix(safeSearchText.lowercased()) {
                    uniqueWords.insert(targetWord)
                }
                
                // 对于数字搜索，额外检查单词中是否包含搜索文本
                // 这样可以捕获如"2 x 10"中的"2"
                if safeSearchText.contains(where: { $0.isNumber }) {
                    if targetWord.contains(safeSearchText) {
                        uniqueWords.insert(targetWord)
                    }
                }
            }
        }
        
        // 如果没有匹配结果且搜索文本为空，返回默认的数字单词建议
        if uniqueWords.isEmpty && safeSearchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            // 直接处理所有零件名称，使用流式处理避免内存问题
            for name in allPartNames {
                guard !name.isEmpty else { continue }
                
                // 使用智能分词
                let words = smartTokenize(name)
                
                // 确保单词索引有效
                if wordIndex < words.count {
                    let targetWord = words[wordIndex]
                    
                    // 只添加包含数字的单词
                    if targetWord.contains(where: { $0.isNumber }) {
                        uniqueWords.insert(targetWord)
                    }
                }
            }
        }
        
        // 将结果转换为数组并排序，数字单词优先显示
        var sortedWords = Array(uniqueWords)
        
        // 取消返回的建议数量限制，使用高效的排序策略处理大型数组
        if sortedWords.count > 1000 {
            // 对大型数组使用更高效的排序策略
            // 先按首字母分组，再对每个组进行排序
            var groupedWords = [Character: [String]]()
            for word in sortedWords {
                let firstChar = word.first ?? " "
                if var group = groupedWords[firstChar] {
                    group.append(word)
                    groupedWords[firstChar] = group
                } else {
                    groupedWords[firstChar] = [word]
                }
            }
            
            // 对每个组进行排序并合并
            var result = [String]()
            for (_, group) in groupedWords.sorted(by: { $0.key < $1.key }) {
                let sortedGroup = group.sorted { 
                    compareWords($0, $1)
                }
                result.append(contentsOf: sortedGroup)
            }
            sortedWords = result
        } else {
            // 对小型数组使用标准排序
            sortedWords.sort { 
                compareWords($0, $1)
            }
        }
        
        // 辅助函数：比较两个单词
        func compareWords(_ word1: String, _ word2: String) -> Bool { 
            // 首先按名称长度排序
            if word1.count != word2.count {
                return word1.count < word2.count
            }
            
            // 长度相同，检查第一个单词是否是数字
            let isFirstNumber = word1.contains(where: { $0.isNumber })
            let isSecondNumber = word2.contains(where: { $0.isNumber })
            
            // 如果一个是数字，一个不是，数字优先
            if isFirstNumber != isSecondNumber {
                return isFirstNumber
            }
            
            // 都是数字，检查是否包含 "x" 形式的数字组合
            if isFirstNumber && isSecondNumber {
                // 提取 "x" 形式数字组合中的所有数字
                func extractNumbersFromXCombination(_ text: String) -> [Int] {
                    var numbers: [Int] = []
                    var currentNumber = ""
                    
                    for char in text {
                        if char.isNumber {
                            currentNumber.append(char)
                        } else if char.lowercased() == "x" && !currentNumber.isEmpty {
                            if let number = Int(currentNumber) {
                                numbers.append(number)
                            }
                            currentNumber = ""
                        } else if !char.isWhitespace && !currentNumber.isEmpty {
                            // 如果遇到非数字、非x、非空格字符，且当前有数字，则添加该数字并停止
                            if let number = Int(currentNumber) {
                                numbers.append(number)
                            }
                            break
                        }
                    }
                    
                    // 添加最后一个数字
                    if !currentNumber.isEmpty, let number = Int(currentNumber) {
                        numbers.append(number)
                    }
                    
                    return numbers
                }
                
                let firstNumbers = extractNumbersFromXCombination(word1)
                let secondNumbers = extractNumbersFromXCombination(word2)
                
                // 如果两者都是 "x" 形式的数字组合，按顺序比较每个数字
                if !firstNumbers.isEmpty && !secondNumbers.isEmpty {
                    for (i, firstNum) in firstNumbers.enumerated() {
                        if i < secondNumbers.count {
                            let secondNum = secondNumbers[i]
                            if firstNum != secondNum {
                                return firstNum < secondNum
                            }
                        } else {
                            // 第一个数字组合更长，排在后面
                            return false
                        }
                    }
                    // 前几个数字都相同，较短的排在前面
                    return firstNumbers.count < secondNumbers.count
                } else if !firstNumbers.isEmpty {
                    // 第一个是 "x" 形式的数字组合，优先
                    return true
                } else if !secondNumbers.isEmpty {
                    // 第二个是 "x" 形式的数字组合，优先
                    return false
                } else {
                    // 都不是 "x" 形式的数字组合，按首串数字的数值排序
                    func extractLeadingNumber(_ text: String) -> Int? {
                        var numberString = ""
                        for char in text {
                            if char.isNumber {
                                numberString.append(char)
                            } else {
                                break
                            }
                        }
                        return Int(numberString)
                    }
                    
                    if let firstNumber = extractLeadingNumber(word1), let secondNumber = extractLeadingNumber(word2) {
                        return firstNumber < secondNumber
                    }
                }
            }
            
            // 都不是数字或无法提取数字，按字典序排序
            return word1 < word2
        }
        
        // 返回限制数量的匹配单词
        return sortedWords
    }
    
    // 获取完整的零件名称建议（基于已输入的单词）
    // - Parameter words: 已输入的单词数组
    // - Parameter limit: 返回结果的最大数量，默认10
    // - Parameter tableType: 数据库表类型，默认为Part表
    // - Returns: 匹配的完整零件名称列表
    static func getCompleteSuggestions(for words: [String], limit: Int = 10, tableType: TableType = .part) -> [String] {
        // 如果单词数组为空，返回空列表
        guard !words.isEmpty else {
            return []
        }
        
        // 获取所有零件名称（使用缓存）
        let allPartNames = getAllPartNames(tableType: tableType)
        
        // 过滤匹配的零件名称
        var matchingNames: [String] = []
        
        // 取消结果数量限制，使用流式处理
        for name in allPartNames {
            guard !name.isEmpty else { continue }
            
            // 使用智能分词
            let nameWords = smartTokenize(name)
            
            // 检查是否匹配所有已输入的单词
            var isMatch = true
            
            for (index, word) in words.enumerated() {
                if index >= nameWords.count {
                    isMatch = false
                    break
                }
                
                let nameWord = nameWords[index]
                if !nameWord.lowercased().hasPrefix(word.lowercased()) {
                    isMatch = false
                    break
                }
            }
            
            if isMatch {
                matchingNames.append(name)
            }
        }
        
        // 排序并返回所有结果，按名称长度排序
        matchingNames.sort { (name1, name2) -> Bool in
            // 首先按名称长度排序
            if name1.count != name2.count {
                return name1.count < name2.count
            }
            // 长度相同，按字典序排序
            return name1 < name2
        }
        return matchingNames
    }
    
    // 异步获取零件名称联想列表
    // - Parameter searchText: 用户输入的搜索文本
    // - Parameter wordIndex: 当前正在输入的单词索引
    // - Parameter previousWords: 之前输入的单词，用于上下文过滤
    // - Parameter tableType: 数据库表类型，默认为Part表
    // - Parameter completion: 完成回调，返回匹配的单词列表
    static func getSuggestionsAsync(for searchText: String, wordIndex: Int = 0, previousWords: [String] = [], tableType: TableType = .part, completion: @escaping ([String]) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            let suggestions = getSuggestions(for: searchText, wordIndex: wordIndex, previousWords: previousWords, tableType: tableType)
            DispatchQueue.main.async {
                completion(suggestions)
            }
        }
    }
    
    // 异步获取完整的零件名称建议
    // - Parameter words: 已输入的单词数组
    // - Parameter limit: 返回结果的最大数量，默认10
    // - Parameter tableType: 数据库表类型，默认为Part表
    // - Parameter completion: 完成回调，返回匹配的完整零件名称列表
    static func getCompleteSuggestionsAsync(for words: [String], limit: Int = 10, tableType: TableType = .part, completion: @escaping ([String]) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            let suggestions = getCompleteSuggestions(for: words, limit: limit, tableType: tableType)
            DispatchQueue.main.async {
                completion(suggestions)
            }
        }
    }
}
