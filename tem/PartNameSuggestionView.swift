//
//  PartNameSuggestionView.swift
//  PARTS
//
//  Created by Guo Ping Hu on 2026/2/23.
//

import SwiftUI
import Foundation
import CoreData

struct PartNameSuggestionView: View {
    @Binding var partNameInput: String
    @Binding var showNameSuggestions: Bool
    @Binding var nameSuggestions: [String]
    @Binding var currentWordIndex: Int
    @Binding var partName: String
    var tableType: PartNameSuggestion.TableType = .parts // 默认使用Parts表（RB数据库）
    var onPartNameChange: ((String) -> Void)? = nil
    var onPartNumberFound: ((String) -> Void)? = nil // 回调，用于传递匹配到的零件型号
    
    // 状态变量
    @State private var isEditing: Bool = false // 跟踪是否在编辑状态
    @State private var partNumberMatchingTimer: Timer? = nil // 用于延迟匹配零件型号的定时器
    
    // 定时器变量
    @State private var nameSuggestionTimer: Timer? = nil
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 10) {
                Text("零件名称：")
                    .font(.system(size: 14))
                    .foregroundColor(Color(red: 0x34/255, green: 0x49/255, blue: 0x5e/255))
                    .fixedSize(horizontal: true, vertical: true)
                ZStack(alignment: .topLeading) {
                    TextField("请输入零件名称", text: $partNameInput)
                        .font(.system(size: 14))
                        .padding(6)
                        .border(Color.gray.opacity(0.3))
                        .cornerRadius(4)
                        .frame(maxWidth: .infinity)
                        .frame(height: 32) // 统一高度
                        .onChange(of: partNameInput) {
                            oldValue, newValue in
                            // 清除之前的定时器
                            nameSuggestionTimer?.invalidate()
                            partNumberMatchingTimer?.invalidate()
                            
                            // 标记为编辑状态
                            isEditing = true
                            
                            // 简化的单词索引处理，避免在主线程上执行复杂的分词操作
                            // 这里只按空格分词，因为智能分词会在后台线程中执行
                            // 但会考虑连续数字的情况
                            func getWordCount(_ text: String) -> Int {
                                let tokens = text.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
                                var count = 0
                                var i = 0
                                
                                while i < tokens.count {
                                    let token = tokens[i]
                                    
                                    // 检查是否是数字，并且后面跟着"x"和另一个数字
                                    if i + 2 < tokens.count, 
                                       let _ = Int(token), 
                                       tokens[i+1].lowercased() == "x", 
                                       let _ = Int(tokens[i+2]) {
                                        // 将"数字 x 数字"视为一个单词
                                        count += 1
                                        i += 3
                                    } else if let _ = Int(token) {
                                        // 检查连续数字
                                        var j = i + 1
                                        while j < tokens.count, let _ = Int(tokens[j]) {
                                            j += 1
                                        }
                                        // 将连续数字视为一个单词
                                        count += 1
                                        i = j
                                    } else {
                                        // 普通单词
                                        count += 1
                                        i += 1
                                    }
                                }
                                
                                return count
                            }
                            
                            // 处理单词索引
                            let previousWords = getWordCount(partNameInput)
                            let newWords = getWordCount(newValue)
                            
                            if newWords > previousWords {
                                // 用户输入了新单词，移动到下一个单词
                                currentWordIndex = newWords - 1
                            } else if newWords < previousWords {
                                // 用户删除了单词，移动到上一个单词
                                currentWordIndex = max(0, newWords - 1)
                            }
                            // 即使单词数不变，也确保currentWordIndex有效
                            currentWordIndex = max(0, min(currentWordIndex, newWords - 1))
                            
                            // 检查输入是否以空格结尾
                            let endsWithSpace = newValue.hasSuffix(" ")
                            
                            // 获取当前正在输入的单词（智能处理，考虑数字和"x"的组合）
                            func getCurrentWord(_ text: String, index: Int) -> String {
                                let tokens = text.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
                                var i = 0
                                var currentIndex = 0
                                
                                while i < tokens.count && currentIndex <= index {
                                    let token = tokens[i]
                                    
                                    // 检查是否是数字，并且后面跟着"x"和另一个数字
                                    if i + 2 < tokens.count, 
                                       let _ = Int(token), 
                                       tokens[i+1].lowercased() == "x", 
                                       let _ = Int(tokens[i+2]) {
                                        // 将"数字 x 数字"视为一个单词
                                        if currentIndex == index {
                                            return "\(token) \(tokens[i+1]) \(tokens[i+2])"
                                        }
                                        currentIndex += 1
                                        i += 3
                                    } else if let _ = Int(token) {
                                        // 检查连续数字
                                        var j = i + 1
                                        while j < tokens.count, let _ = Int(tokens[j]) {
                                            j += 1
                                        }
                                        // 将连续数字视为一个单词
                                        if currentIndex == index {
                                            return tokens[i..<j].joined(separator: " ")
                                        }
                                        currentIndex += 1
                                        i = j
                                    } else {
                                        // 普通单词
                                        if currentIndex == index {
                                            return token
                                        }
                                        currentIndex += 1
                                        i += 1
                                    }
                                }
                                
                                // 如果没有找到对应索引的单词，返回最后一个单词或空字符串
                                return tokens.last ?? ""
                            }
                            
                            // 确定当前单词和单词索引
                            var effectiveCurrentWord: String
                            var effectiveWordIndex: Int
                            
                            if endsWithSpace {
                                // 如果输入以空格结尾，准备下一个单词的联想
                                effectiveCurrentWord = ""
                                effectiveWordIndex = currentWordIndex + 1
                            } else {
                                // 否则，继续当前单词的联想
                                effectiveCurrentWord = getCurrentWord(newValue, index: currentWordIndex)
                                effectiveWordIndex = currentWordIndex
                            }
                            
                            // 设置新的定时器，延迟0.5秒后触发查询，用户停止输入后开始联想
                            nameSuggestionTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: false) { _ in
                                // 检查输入是否已被修改
                                let currentInput = partNameInput
                                
                                // 限制输入长度，避免过长输入导致性能问题
                                if currentInput.count > 100 {
                                    print("输入过长，不触发联想")
                                    return
                                }
                                
                                // 获取之前输入的单词（使用智能分词）
                                let previousWords = PartNameSuggestionView.smartTokenize(currentInput)
                                
                                if !effectiveCurrentWord.isEmpty {
                                    // 使用异步获取联想建议，基于当前单词索引和之前的单词
                                    PartNameSuggestion.getSuggestionsAsync(for: effectiveCurrentWord, wordIndex: effectiveWordIndex, previousWords: previousWords, tableType: tableType) { suggestions in
                                        DispatchQueue.main.async {
                                            // 确保输入没有变化
                                            if partNameInput == currentInput {
                                                // 限制建议数量，避免过多建议导致UI卡顿
                                                let limitedSuggestions = Array(suggestions.prefix(30))
                                                nameSuggestions = limitedSuggestions
                                                showNameSuggestions = !limitedSuggestions.isEmpty
                                            }
                                        }
                                    }
                                } else {
                                    // 当currentWord为空时（输入以空格结尾），尝试获取下一个可能的单词
                                    PartNameSuggestion.getSuggestionsAsync(for: "", wordIndex: effectiveWordIndex, previousWords: previousWords, tableType: tableType) { suggestions in
                                        DispatchQueue.main.async {
                                            // 确保输入没有变化
                                            if partNameInput == currentInput {
                                                // 限制建议数量，避免过多建议导致UI卡顿
                                                let limitedSuggestions = Array(suggestions.prefix(30))
                                                nameSuggestions = limitedSuggestions
                                                showNameSuggestions = !limitedSuggestions.isEmpty
                                            }
                                        }
                                    }
                                }
                            }
                            
                            // 设置新的定时器，延迟1秒后触发零件型号匹配
                            partNumberMatchingTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: false) { _ in
                                // 检查输入是否已被修改
                                let currentInput = partNameInput
                                
                                // 限制输入长度，避免过长输入导致性能问题
                                if currentInput.count > 100 {
                                    print("输入过长，不触发零件型号匹配")
                                    return
                                }
                                
                                // 只有在编辑状态或显示建议时才进行匹配
                                if isEditing || showNameSuggestions {
                                    // 匹配零件型号
                                    matchPartNumber(from: currentInput)
                                }
                            }
                        }
                        .onTapGesture {
                            // 检查输入是否以空格结尾
                            let endsWithSpace = partNameInput.hasSuffix(" ")
                            
                            // 限制输入长度，避免过长输入导致性能问题
                            if partNameInput.count > 100 {
                                print("输入过长，不触发联想")
                                return
                            }
                            
                            // 获取之前输入的单词（使用智能分词）
                            let previousWords = PartNameSuggestionView.smartTokenize(partNameInput)
                            
                            // 确定当前单词和单词索引
                            var effectiveCurrentWord: String
                            var effectiveWordIndex: Int
                            
                            if endsWithSpace {
                                // 如果输入以空格结尾，准备下一个单词的联想
                                effectiveCurrentWord = ""
                                effectiveWordIndex = previousWords.count
                            } else {
                                // 否则，继续当前单词的联想
                                effectiveCurrentWord = previousWords.last ?? ""
                                effectiveWordIndex = previousWords.count - 1
                            }
                            
                            // 确保effectiveWordIndex不为负数
                            effectiveWordIndex = max(0, effectiveWordIndex)
                            
                            // 触发联想
                            PartNameSuggestion.getSuggestionsAsync(for: effectiveCurrentWord, wordIndex: effectiveWordIndex, previousWords: previousWords, tableType: tableType) { suggestions in
                                DispatchQueue.main.async {
                                    // 限制建议数量，避免过多建议导致UI卡顿
                                    let limitedSuggestions = Array(suggestions.prefix(30))
                                    nameSuggestions = limitedSuggestions
                                    showNameSuggestions = !limitedSuggestions.isEmpty
                                }
                            }
                        }
                    

                }
            }
            
            // 联想建议弹出窗口
            if showNameSuggestions && !nameSuggestions.isEmpty {
                // 弹出窗口定位在输入框下方
                ZStack(alignment: .top) {
                    // 占位符，用于定位
                    Color.clear
                        .frame(height: 0)
                    
                    // 建议弹出窗口
                    SuggestionPopupView(
                        suggestions: nameSuggestions,
                        onSelect: { suggestion in
                            // 检查输入是否以空格结尾
                            let endsWithSpace = partNameInput.hasSuffix(" ")
                            
                            // 获取当前输入的非空单词数组
                            var words = partNameInput.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
                            
                            // 根据是否以空格结尾决定是替换还是添加
                            if endsWithSpace {
                                // 以空格结尾，添加新单词
                                words.append(suggestion)
                            } else {
                                // 不以空格结尾，替换最后一个单词
                                if !words.isEmpty {
                                    words[words.count - 1] = suggestion
                                } else {
                                    // 输入为空，添加新单词
                                    words.append(suggestion)
                                }
                            }
                            
                            // 更新输入框内容，添加空格以便输入下一个单词
                            partNameInput = words.joined(separator: " ") + " "
                            partName = partNameInput.trimmingCharacters(in: .whitespaces)
                            // 通知外部partName已变化
                            onPartNameChange?(partName)
                            
                            // 移动到下一个单词索引
                            currentWordIndex = words.count
                            
                            // 隐藏当前建议列表
                            showNameSuggestions = false
                            
                            // 立即触发下一个单词的联想
                            // 模拟用户输入空格后的行为，触发下一个单词的联想
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                                // 获取新的输入文本
                                let newText = partNameInput
                                
                                // 限制输入长度，避免过长输入导致性能问题
                                if newText.count > 100 {
                                    print("输入过长，不触发联想")
                                    return
                                }
                                
                                // 计算新的单词数
                                func getWordCount(_ text: String) -> Int {
                                    let tokens = text.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
                                    var count = 0
                                    var i = 0
                                    
                                    // 限制处理的token数量，提高性能
                                    let maxTokens = 20
                                    let safeTokens = Array(tokens.prefix(maxTokens))
                                    
                                    while i < safeTokens.count {
                                        let token = safeTokens[i]
                                        
                                        // 检查是否是数字，并且后面跟着"x"和另一个数字
                                        if i + 2 < safeTokens.count, 
                                           let _ = Int(token), 
                                           safeTokens[i+1].lowercased() == "x", 
                                           let _ = Int(safeTokens[i+2]) {
                                            // 将"数字 x 数字"视为一个单词
                                            count += 1
                                            i += 3
                                        } else if let _ = Int(token) {
                                            // 检查连续数字
                                            var j = i + 1
                                            while j < safeTokens.count, let _ = Int(safeTokens[j]) {
                                                j += 1
                                            }
                                            // 将连续数字视为一个单词
                                            count += 1
                                            i = j
                                        } else {
                                            // 普通单词
                                            count += 1
                                            i += 1
                                        }
                                    }
                                    
                                    return count
                                }
                                
                                let newWords = getWordCount(newText)
                                currentWordIndex = max(0, min(currentWordIndex, newWords - 1))
                                
                                // 获取当前正在输入的单词（空字符串，因为刚输入了空格）
                                let currentWord = ""
                                
                                // 获取之前输入的单词（使用智能分词）
                                let previousWords = PartNameSuggestionView.smartTokenize(newText)
                                
                                // 触发下一个单词的联想
                                if !currentWord.isEmpty {
                                    PartNameSuggestion.getSuggestionsAsync(for: currentWord, wordIndex: currentWordIndex, previousWords: previousWords, tableType: tableType) { suggestions in
                                        DispatchQueue.main.async {
                                            // 限制建议数量，避免过多建议导致UI卡顿
                                            let limitedSuggestions = Array(suggestions.prefix(30))
                                            nameSuggestions = limitedSuggestions
                                            showNameSuggestions = !limitedSuggestions.isEmpty
                                        }
                                    }
                                } else {
                                    // 当currentWord为空时，尝试获取下一个可能的单词
                                    PartNameSuggestion.getSuggestionsAsync(for: "", wordIndex: currentWordIndex, previousWords: previousWords, tableType: tableType) { suggestions in
                                        DispatchQueue.main.async {
                                            // 限制建议数量，避免过多建议导致UI卡顿
                                            let limitedSuggestions = Array(suggestions.prefix(30))
                                            nameSuggestions = limitedSuggestions
                                            showNameSuggestions = !limitedSuggestions.isEmpty
                                        }
                                    }
                                }
                            }
                        },
                        onCancel: {
                            // 隐藏建议窗口
                            showNameSuggestions = false
                        }
                    )
                    .frame(width: 500, height: 400) // 减小窗口大小，提高性能
                    .background(Color.white)
                    .cornerRadius(10)
                    .shadow(radius: 5)
                    .padding(.top, 10) // 距离输入框的距离
                }
            }
        }
    }
    
    // 根据零件名称匹配零件型号
    private func matchPartNumber(from partName: String) {
        guard !partName.isEmpty else { return }
        
        // 清理输入
        let cleanPartName = partName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanPartName.isEmpty else { return }
        
        // 在后台线程执行数据库查询，避免阻塞主线程
        DispatchQueue.global(qos: .userInitiated).async {
            // 获取PersistenceController.shared
            let persistence = PersistenceController.shared
            
            // 创建私有上下文用于后台线程
            let privateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
            privateContext.parent = persistence.rbContainer.viewContext
            
            var matchedPartNumber: String? = nil
            
            privateContext.performAndWait { 
                // 创建查询请求，使用精准匹配
                let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Parts")
                // 使用精准匹配，确保匹配的准确性
                fetchRequest.predicate = NSPredicate(format: "name == %@", cleanPartName)
                // 限制结果数量，提高性能
                fetchRequest.fetchLimit = 1
                
                do {
                    let parts = try privateContext.fetch(fetchRequest)
                    if let part = parts.first {
                        matchedPartNumber = part.value(forKey: "part_num") as? String
                    }
                } catch {
                    print("Error matching part number: \(error)")
                }
            }
            
            // 在主线程更新UI
            if let partNumber = matchedPartNumber {
                DispatchQueue.main.async {
                    // 调用回调，传递匹配到的零件型号
                    self.onPartNumberFound?(partNumber)
                }
            }
        }
    }
    
    // 智能分词方法
    static func smartTokenize(_ text: String) -> [String] {
        // 快速路径：如果文本不包含"x"且不包含数字，直接按空格分词
        guard text.contains("x") || text.contains("X") || text.contains(where: { $0.isNumber }) else {
            return text.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
        }
        
        // 否则执行智能分词
        let tokens = text.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
        var result: [String] = []
        
        var i = 0
        while i < tokens.count {
            let token = tokens[i]
            
            // 检查是否是数字，并且后面跟着"x"和另一个数字
            if i + 2 < tokens.count, 
               let _ = Int(token), 
               tokens[i+1].lowercased() == "x", 
               let _ = Int(tokens[i+2]) {
                // 将"数字 x 数字"视为一个单词
                let combinedToken = "\(token) \(tokens[i+1]) \(tokens[i+2])"
                result.append(combinedToken)
                i += 3
            } else {
                // 检查是否是数字
                if let _ = Int(token) {
                    // 将连续的数字视为一个整体
                    var numberTokens = [token]
                    var j = i + 1
                    
                    // 检查后续是否也是数字
                    while j < tokens.count, let _ = Int(tokens[j]) {
                        numberTokens.append(tokens[j])
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
        
        return result
    }
}

// 联想建议弹出窗口
struct SuggestionPopupView: View {
    let suggestions: [String]
    let onSelect: (String) -> Void
    let onCancel: (() -> Void)?
    
    // 按数值分组并排序
    private var groupedSuggestions: [(key: String, value: [String])] {
        // 首先处理排序：数字单词优先，然后按数值排序
        let sortedSuggestions = suggestions.sorted { 
            // 检查是否是数字相关单词
            let isFirstNumber = $0.contains(where: { $0.isNumber }) || $0.lowercased().contains("x")
            let isSecondNumber = $1.contains(where: { $0.isNumber }) || $1.lowercased().contains("x")
            
            if isFirstNumber != isSecondNumber {
                return isFirstNumber
            }
            
            // 对于包含 "x" 的组合，按数值排序
            if $0.lowercased().contains("x") && $1.lowercased().contains("x") {
                // 提取数字数组用于比较
                func extractNumbers(_ text: String) -> [Int] {
                    let components = text.components(separatedBy: CharacterSet(charactersIn: "xX ")).filter { !$0.isEmpty }
                    return components.compactMap { Int($0) }
                }
                
                let firstNumbers = extractNumbers($0)
                let secondNumbers = extractNumbers($1)
                
                // 按数字数组顺序比较
                for (a, b) in zip(firstNumbers, secondNumbers) {
                    if a != b {
                        return a < b
                    }
                }
                // 如果前面的数字都相同，较短的排在前面
                return firstNumbers.count < secondNumbers.count
            }
            
            // 对于纯数字，按数值排序
            if let firstNum = Int($0.components(separatedBy: .whitespaces).first ?? ""), 
               let secondNum = Int($1.components(separatedBy: .whitespaces).first ?? "") {
                return firstNum < secondNum
            }
            
            // 其他情况按字母顺序排序
            return $0 < $1
        }
        
        // 按数值分组
        var groups = [String: [String]]()
        
        for suggestion in sortedSuggestions {
            var key: String
            
            // 提取分组键
            if suggestion.lowercased().contains("x") {
                // 对于 "A x B" 格式，使用第一个数字作为分组键
                let components = suggestion.components(separatedBy: CharacterSet(charactersIn: "xX ")).filter { !$0.isEmpty }
                if let firstNum = components.first.flatMap({ Int($0) }) {
                    key = String(firstNum)
                } else {
                    // 如果无法提取数字，使用首字母
                    key = suggestion.prefix(1).uppercased()
                }
            } else if let firstWord = suggestion.components(separatedBy: .whitespaces).first, let num = Int(firstWord) {
                // 对于纯数字开头的单词，使用数字作为分组键
                key = String(num)
            } else {
                // 对于其他单词，使用首字母作为分组键
                key = suggestion.prefix(1).uppercased()
            }
            
            if var group = groups[key] {
                // 对同一组内的项目进行排序，特别是处理 "A x B" 格式
                group.append(suggestion)
                // 对组内项目按第二个数字排序（如果有）
                group.sort { 
                    if $0.lowercased().contains("x") && $1.lowercased().contains("x") {
                        func extractNumbers(_ text: String) -> [Int] {
                            let components = text.components(separatedBy: CharacterSet(charactersIn: "xX ")).filter { !$0.isEmpty }
                            return components.compactMap { Int($0) }
                        }
                        
                        let firstNumbers = extractNumbers($0)
                        let secondNumbers = extractNumbers($1)
                        
                        // 按第二个数字排序
                        if firstNumbers.count > 1 && secondNumbers.count > 1 {
                            return firstNumbers[1] < secondNumbers[1]
                        }
                    }
                    return $0 < $1
                }
                groups[key] = group
            } else {
                groups[key] = [suggestion]
            }
        }
        
        // 转换为排序后的数组，数字键按数值排序，字母键按字母顺序排序
        return groups.sorted { 
            // 尝试将键转换为数字进行比较
            if let firstNum = Int($0.key), let secondNum = Int($1.key) {
                return firstNum < secondNum
            }
            // 一个是数字，一个是字母，数字在前
            if Int($0.key) != nil {
                return true
            }
            if Int($1.key) != nil {
                return false
            }
            // 都是字母，按字母顺序排序
            return $0.key < $1.key
        }
    }
    
    var body: some View {
        VStack(spacing: 10) {
            // 标题
            HStack {
                Text("选择建议单词")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(Color(red: 0x2c/255, green: 0x3e/255, blue: 0x50/255))
                Spacer()
                // 退回按钮
                if let onCancel = onCancel {
                    Button(action: onCancel) {
                        Text("退回")
                            .font(.system(size: 14))
                            .foregroundColor(.blue)
                    }
                }
            }
            .padding(15)
            .border(bottom: Color.gray.opacity(0.2))
            
            // 分组建议
            ScrollView(.vertical, showsIndicators: true) {
                VStack(spacing: 15) {
                    // 限制显示的组数量，提高性能
                    let limitedGroups = Array(groupedSuggestions.prefix(10))
                    ForEach(limitedGroups, id: \.key) {
                        group in
                        VStack(alignment: .leading, spacing: 8) {
                            // 组标题
                            Text(group.key)
                                .font(.system(size: 14, weight: .bold))
                                .foregroundColor(Color(red: 0x34/255, green: 0x49/255, blue: 0x5e/255))
                                .padding(.horizontal, 15)
                            
                            // 水平滚动的单词列表
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 8) {
                                    // 限制每个组显示的建议数量，提高性能
                                    let limitedSuggestions = Array(group.value.prefix(20))
                                    ForEach(limitedSuggestions, id: \.self) {
                                        suggestion in
                                        Button(action: {
                                            onSelect(suggestion)
                                        }) {
                                            Text(suggestion)
                                                .font(.system(size: 14))
                                                .foregroundColor(.primary)
                                                .padding(.horizontal, 12)
                                                .padding(.vertical, 8)
                                                .background(Color(red: 0xf8/255, green: 0xf9/255, blue: 0xfa/255))
                                                .border(Color.gray.opacity(0.2))
                                                .cornerRadius(4)
                                        }
                                    }
                                }
                                .padding(.horizontal, 15)
                            }
                        }
                    }
                }
                .padding(10)
            }
        }
        .frame(width: 500, height: 400) // 减小窗口大小，提高性能
    }
}

// 扩展View，添加底部边框
extension View {
    func border(bottom: Color) -> some View {
        self.modifier(BottomBorderModifier(color: bottom))
    }
}

// 底部边框修饰符
struct BottomBorderModifier: ViewModifier {
    let color: Color
    
    func body(content: Content) -> some View {
        content
            .overlay(
                Rectangle()
                    .frame(height: 1, alignment: .bottom)
                    .foregroundColor(color)
                , alignment: .bottom
            )
    }
}
